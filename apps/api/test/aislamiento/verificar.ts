import type { PrismaBase } from '../../src/db/prisma';
import type { Express } from 'express';
import request from 'supertest';
import type { DefinicionRuta } from '../../src/http/registro';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

export interface FalloAislamiento {
  ruta: string;
  motivo: string;
}

type Escenario = Awaited<ReturnType<NonNullable<DefinicionRuta['aislamiento']>['preparar']>>;

const patronDeRuta = (ruta: string): RegExp =>
  new RegExp(
    `^${ruta
      .split('/')
      .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')}$`,
  );

export type SesionPara = (ids: { usuarioId: string; organizacionId: string }) => Promise<Record<string, string>>;

export async function verificarAislamiento(opciones: {
  app: Express;
  definiciones: readonly DefinicionRuta[];
  prisma: PrismaBase;
  sesionPara: SesionPara;
}): Promise<{ revisadas: number; fallos: FalloAislamiento[] }> {
  const fallos: FalloAislamiento[] = [];
  // Falla cerrado: toda ruta que no sea PUBLICA se revisa (las fases siguientes agregan INTERNA y PLATAFORMA).
  const rutasRevisadas = opciones.definiciones.filter((d) => d.acceso !== 'PUBLICA');

  for (const def of rutasRevisadas) {
    const nombre = `${def.metodo.toUpperCase()} ${def.ruta}`;
    if (!def.aislamiento) {
      fallos.push({ ruta: nombre, motivo: 'sin escenario de aislamiento' });
      continue;
    }

    const duena = await crearOrganizacion();
    const intrusa = await crearOrganizacion();
    const persona = await crearUsuario();
    await crearMembresia(persona.id, intrusa.id, 'OWNER');
    const miembroDueno = await crearUsuario();
    await crearMembresia(miembroDueno.id, duena.id, 'OWNER');

    const contexto = { organizacionId: duena.id, prisma: opciones.prisma };
    const patron = patronDeRuta(def.ruta);
    const envio = async (escenario: Escenario, cabeceras: Record<string, string>) => {
      let peticion = request(opciones.app)[def.metodo](escenario.ruta).set(cabeceras);
      if (escenario.tipo === 'RECURSO' && escenario.cuerpo !== undefined) {
        peticion = peticion.send(escenario.cuerpo as object);
      }
      return peticion;
    };

    // Escenario para el control positivo (y para la verificación si la ruta es de solo lectura).
    const escenarioControl = await def.aislamiento.preparar(contexto);
    if (!patron.test(escenarioControl.ruta.split('?')[0] ?? '')) {
      fallos.push({ ruta: nombre, motivo: 'la ruta del escenario no coincide con la ruta registrada' });
      continue;
    }

    const cabecerasDuena = await opciones.sesionPara({ usuarioId: miembroDueno.id, organizacionId: duena.id });
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
    const escenario = def.metodo === 'get' ? escenarioControl : await def.aislamiento.preparar(contexto);
    if (!patron.test(escenario.ruta.split('?')[0] ?? '')) {
      fallos.push({ ruta: nombre, motivo: 'la ruta del escenario no coincide con la ruta registrada' });
      continue;
    }
    const cabeceras = await opciones.sesionPara({ usuarioId: persona.id, organizacionId: intrusa.id });
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
