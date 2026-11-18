import { Prisma } from '@prisma/client';

/** Error de programación: una consulta intentó saltarse el aislamiento entre empresas. */
export class ViolacionMultiempresaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ViolacionMultiempresaError';
  }
}

/** Consulta que necesita un contexto (de empresa o de plataforma) y se hizo sin ninguno. */
export class SinContextoTenantError extends Error {
  constructor(modelo: string, operacion: string) {
    super(`Consulta a ${modelo}.${operacion} sin contexto de empresa`);
    this.name = 'SinContextoTenantError';
  }
}

const MODELOS = Prisma.dmmf.datamodel.models;

/** Modelos multiempresa = todo modelo con un campo `organizacionId`. Se deriva del schema: no se puede olvidar uno. */
export const MODELOS_TENANT: ReadonlySet<string> = new Set(
  MODELOS.filter((m) => m.fields.some((f) => f.name === 'organizacionId')).map((m) => m.name),
);

if (MODELOS_TENANT.size === 0) {
  throw new Error('No se detectó ningún modelo multiempresa en el schema: el aislamiento quedaría apagado');
}

/** modelo → (campo de relación → modelo destino) */
const RELACIONES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(
  MODELOS.map((m) => [m.name, new Map(m.fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type]))]),
);

const COMBINADORES = new Set(['AND', 'OR', 'NOT']);
const FILTROS_DE_RELACION = new Set(['some', 'every', 'none', 'is', 'isNot']);

export function esModeloTenant(modelo: string): boolean {
  return MODELOS_TENANT.has(modelo);
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function destinoDe(modelo: string, campo: string): string | undefined {
  return RELACIONES.get(modelo)?.get(campo);
}

function cruzar(origen: string, destino: string, ruta: string): void {
  if (esModeloTenant(destino) && !esModeloTenant(origen)) {
    throw new ViolacionMultiempresaError(
      `${ruta}: no se puede llegar a ${destino} (multiempresa) desde ${origen} (global) fuera del modo plataforma`,
    );
  }
}

function revisarWhere(modelo: string, where: unknown, ruta: string): void {
  if (Array.isArray(where)) {
    where.forEach((w, i) => revisarWhere(modelo, w, `${ruta}[${i}]`));
    return;
  }
  if (!esObjeto(where)) return;
  for (const [clave, valor] of Object.entries(where)) {
    if (COMBINADORES.has(clave)) {
      revisarWhere(modelo, valor, `${ruta}.${clave}`);
      continue;
    }
    const destino = destinoDe(modelo, clave);
    if (!destino) continue;
    if (valor === undefined || valor === false) continue;
    cruzar(modelo, destino, `${ruta}.${clave}`);
    if (!esObjeto(valor)) continue;
    const filtros = Object.keys(valor).filter((k) => FILTROS_DE_RELACION.has(k));
    if (filtros.length === 0) revisarWhere(destino, valor, `${ruta}.${clave}`);
    for (const filtro of filtros) revisarWhere(destino, valor[filtro], `${ruta}.${clave}.${filtro}`);
  }
}

function revisarOrden(modelo: string, orden: unknown, ruta: string): void {
  if (Array.isArray(orden)) {
    orden.forEach((o, i) => revisarOrden(modelo, o, `${ruta}[${i}]`));
    return;
  }
  if (!esObjeto(orden)) return;
  for (const [clave, valor] of Object.entries(orden)) {
    const destino = destinoDe(modelo, clave);
    if (!destino) continue;
    if (valor === undefined || valor === false) continue;
    cruzar(modelo, destino, `${ruta}.${clave}`);
    revisarOrden(destino, valor, `${ruta}.${clave}`);
  }
}

function revisarConteo(modelo: string, conteo: unknown, ruta: string): void {
  if (conteo === true) {
    for (const [campo, destino] of RELACIONES.get(modelo) ?? []) cruzar(modelo, destino, `${ruta}.${campo}`);
    return;
  }
  if (!esObjeto(conteo) || !esObjeto(conteo.select)) return;
  for (const [campo, valor] of Object.entries(conteo.select)) {
    const destino = destinoDe(modelo, campo);
    if (!destino) continue;
    if (valor === undefined || valor === false) continue;
    cruzar(modelo, destino, `${ruta}.select.${campo}`);
    if (esObjeto(valor)) revisarWhere(destino, valor.where, `${ruta}.select.${campo}.where`);
  }
}

function revisarSeleccion(modelo: string, seleccion: unknown, ruta: string): void {
  if (!esObjeto(seleccion)) return;
  for (const [clave, valor] of Object.entries(seleccion)) {
    if (clave === '_count') {
      revisarConteo(modelo, valor, `${ruta}._count`);
      continue;
    }
    const destino = destinoDe(modelo, clave);
    if (!destino) continue;
    if (valor === undefined || valor === false) continue;
    cruzar(modelo, destino, `${ruta}.${clave}`);
    if (!esObjeto(valor)) continue;
    revisarWhere(destino, valor.where, `${ruta}.${clave}.where`);
    revisarOrden(destino, valor.orderBy, `${ruta}.${clave}.orderBy`);
    revisarSeleccion(destino, valor.include, `${ruta}.${clave}.include`);
    revisarSeleccion(destino, valor.select, `${ruta}.${clave}.select`);
  }
}

function revisarDatos(modelo: string, datos: unknown, ruta: string): void {
  if (Array.isArray(datos)) {
    datos.forEach((d, i) => revisarDatos(modelo, d, `${ruta}[${i}]`));
    return;
  }
  if (!esObjeto(datos)) return;
  for (const clave of Object.keys(datos)) {
    if (destinoDe(modelo, clave)) {
      throw new ViolacionMultiempresaError(
        `${ruta}.${clave}: fuera del modo plataforma no se permiten escrituras anidadas por relación; usa FKs escalares`,
      );
    }
  }
}

/** Revisa los argumentos de una operación Prisma. Lanza ViolacionMultiempresaError si cruzan el aislamiento. */
export function verificarRelaciones(modelo: string, args: Record<string, unknown>): void {
  revisarWhere(modelo, args.where, 'where');
  revisarSeleccion(modelo, args.include, 'include');
  revisarSeleccion(modelo, args.select, 'select');
  revisarOrden(modelo, args.orderBy, 'orderBy');
  revisarDatos(modelo, args.data, 'data');
  revisarDatos(modelo, args.create, 'create');
  revisarDatos(modelo, args.update, 'update');
}
