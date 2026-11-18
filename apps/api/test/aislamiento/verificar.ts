import { randomUUID } from 'node:crypto';
import type { Rol } from '@prisma/client';
import type { PrismaBase } from '../../src/db/prisma';
import type { Express } from 'express';
import request from 'supertest';
import { esNoAplica, type DefinicionRuta, type EscenarioAislamiento } from '../../src/http/registro';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

export interface FalloAislamiento {
  ruta: string;
  motivo: string;
}

type Escenario = Awaited<ReturnType<EscenarioAislamiento['preparar']>>;

const patronDeRuta = (ruta: string): RegExp =>
  new RegExp(
    `^${ruta
      .split('/')
      .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')}$`,
  );

/** Cabeceras de sesión (cookie, CSRF, Origin). Sin `organizacionId`, sesión sin empresa; `rol` es el de la membresía. */
export type SesionPara = (ids: { usuarioId: string; organizacionId?: string; rol?: Rol }) => Promise<Record<string, string>>;

/** Cómo se revisa cada ruta. Falla cerrado: un acceso desconocido se trata como TENANT (exige escenario). */
function clasificar(def: DefinicionRuta): 'PUBLICA' | 'NO_APLICA' | 'PLATAFORMA' | 'ESCENARIO' {
  switch (def.acceso) {
    case 'PUBLICA':
      return 'PUBLICA';
    case 'PLATAFORMA':
      return 'PLATAFORMA';
    case 'AUTENTICADA':
      return def.aislamiento && esNoAplica(def.aislamiento) ? 'NO_APLICA' : 'ESCENARIO';
    case 'TENANT':
      return 'ESCENARIO';
    default:
      return 'ESCENARIO';
  }
}

const ROLES_DE_EMPRESA: readonly Rol[] = ['OWNER', 'ADMIN', 'RECLUTADOR'];

/**
 * PLATAFORMA: un OWNER, un ADMIN y un RECLUTADOR (cada uno en su empresa) y una sesión sin empresa, ninguno superadmin,
 * con los `:param` como UUID aleatorios: todos deben recibir 403 FORBIDDEN.
 */
async function revisarPlataforma(def: DefinicionRuta, opciones: OpcionesVerificar): Promise<string | null> {
  const ruta = def.ruta
    .split('/')
    .map((seg) => (seg.startsWith(':') ? randomUUID() : seg))
    .join('/');
  const quienes: { nombre: string; rol?: Rol }[] = [...ROLES_DE_EMPRESA.map((rol) => ({ nombre: rol, rol })), { nombre: 'sin empresa' }];
  for (const { nombre, rol } of quienes) {
    const usuario = await crearUsuario();
    let cabeceras: Record<string, string>;
    if (rol) {
      const org = await crearOrganizacion();
      await crearMembresia(usuario.id, org.id, rol);
      cabeceras = await opciones.sesionPara({ usuarioId: usuario.id, organizacionId: org.id, rol });
    } else {
      cabeceras = await opciones.sesionPara({ usuarioId: usuario.id });
    }
    const res = await request(opciones.app)[def.metodo](ruta).set(cabeceras);
    // Se exige el código, no solo el 403: un CSRF_INVALIDO también es 403 y ocultaría una ruta sin exigirSuperadmin.
    const codigo = (res.body as { error?: { code?: string } } | undefined)?.error?.code;
    if (res.status !== 403 || codigo !== 'FORBIDDEN') {
      return `esperaba 403 FORBIDDEN para alguien que no es superadmin (${nombre}), recibió ${res.status}${codigo ? ` ${codigo}` : ''}`;
    }
  }
  return null;
}

interface OpcionesVerificar {
  app: Express;
  definiciones: readonly DefinicionRuta[];
  prisma: PrismaBase;
  sesionPara: SesionPara;
}

export async function verificarAislamiento(
  opciones: OpcionesVerificar,
): Promise<{ revisadas: number; fallos: FalloAislamiento[] }> {
  const fallos: FalloAislamiento[] = [];
  // Falla cerrado: toda ruta que no sea PUBLICA cuenta como revisada.
  const rutasRevisadas = opciones.definiciones.filter((d) => clasificar(d) !== 'PUBLICA');

  for (const def of rutasRevisadas) {
    const nombre = `${def.metodo.toUpperCase()} ${def.ruta}`;
    const clase = clasificar(def);
    if (clase === 'NO_APLICA') continue;
    if (clase === 'PLATAFORMA') {
      const motivo = await revisarPlataforma(def, opciones);
      if (motivo) fallos.push({ ruta: nombre, motivo });
      continue;
    }
    if (!def.aislamiento || esNoAplica(def.aislamiento)) {
      fallos.push({ ruta: nombre, motivo: 'sin escenario de aislamiento' });
      continue;
    }
    const escenarioDef = def.aislamiento;
    const duena = await crearOrganizacion();
    const intrusa = await crearOrganizacion();
    // Con roles, control positivo e intrusa usan el primero: con otro rol recibirían 403 y no probarían nada.
    const rol: Rol = def.roles?.[0] ?? 'OWNER';
    const persona = await crearUsuario();
    await crearMembresia(persona.id, intrusa.id, rol);
    const miembroDueno = await crearUsuario();
    await crearMembresia(miembroDueno.id, duena.id, rol);

    const contexto = { organizacionId: duena.id, prisma: opciones.prisma };
    const patron = patronDeRuta(def.ruta);
    const envio = async (escenario: Escenario, cabeceras: Record<string, string>) => {
      let peticion = request(opciones.app)[def.metodo](escenario.ruta).set(cabeceras);
      // Un PUT a una colección (p. ej. la empresa propia) también necesita un cuerpo válido.
      if (escenario.cuerpo !== undefined) {
        peticion = peticion.send(escenario.cuerpo as object);
      }
      return peticion;
    };

    // Escenario para el control positivo (y para la verificación si la ruta es de solo lectura).
    const escenarioControl = await escenarioDef.preparar(contexto);
    if (!patron.test(escenarioControl.ruta.split('?')[0] ?? '')) {
      fallos.push({ ruta: nombre, motivo: 'la ruta del escenario no coincide con la ruta registrada' });
      continue;
    }

    const cabecerasDuena = await opciones.sesionPara({ usuarioId: miembroDueno.id, organizacionId: duena.id, rol });
    const control = await envio(escenarioControl, cabecerasDuena);
    if (control.status < 200 || control.status >= 300) {
      fallos.push({ ruta: nombre, motivo: `control positivo: la empresa dueña recibió ${control.status}` });
      continue;
    }
    if (escenarioControl.tipo === 'COLECCION' && !control.text.includes(escenarioControl.marcador)) {
      fallos.push({ ruta: nombre, motivo: 'control positivo: la empresa dueña no vio su propio marcador' });
      continue;
    }

    // Una petición mutante pudo alterar el recurso: se prepara uno nuevo para el intruso.
    const escenario = def.metodo === 'get' ? escenarioControl : await escenarioDef.preparar(contexto);
    if (!patron.test(escenario.ruta.split('?')[0] ?? '')) {
      fallos.push({ ruta: nombre, motivo: 'la ruta del escenario no coincide con la ruta registrada' });
      continue;
    }
    const cabeceras = await opciones.sesionPara({ usuarioId: persona.id, organizacionId: intrusa.id, rol });
    const res = await envio(escenario, cabeceras);

    if (escenario.tipo === 'RECURSO' && res.status !== 404) {
      fallos.push({ ruta: nombre, motivo: `esperaba 404 desde otra empresa, recibió ${res.status}` });
    }
    if (escenario.tipo === 'COLECCION') {
      if (res.status >= 400) {
        fallos.push({ ruta: nombre, motivo: `la colección respondió ${res.status}` });
      } else if (res.text.includes(escenario.marcador)) {
        fallos.push({ ruta: nombre, motivo: 'la respuesta incluye datos de otra empresa' });
      }
    }
  }

  return { revisadas: rutasRevisadas.length, fallos };
}
