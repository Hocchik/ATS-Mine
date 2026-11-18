import { AsyncLocalStorage } from 'node:async_hooks';

export type ContextoEmpresa =
  | { modo: 'tenant'; organizacionId: string }
  | { modo: 'plataforma'; motivo: string };

const almacen = new AsyncLocalStorage<ContextoEmpresa>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta `fn` con la empresa activa y devuelve siempre una promesa. Se hace await de `fn` dentro del contexto
 * porque las consultas de Prisma son perezosas: el contexto se lee al ejecutar la consulta, no al construirla.
 * No permite cambiar a otra empresa dentro de un contexto de empresa (sí desde el modo plataforma).
 */
export async function ejecutarEnTenant<T>(organizacionIdRecibido: string, fn: () => T): Promise<Awaited<T>> {
  const organizacionId = organizacionIdRecibido.toLowerCase();
  if (!UUID.test(organizacionId)) throw new Error('organizacionId inválido para el contexto de empresa');
  const actual = almacen.getStore();
  if (actual?.modo === 'tenant' && actual.organizacionId !== organizacionId) {
    throw new Error('No se puede cambiar de empresa dentro de un contexto de empresa');
  }
  return almacen.run({ modo: 'tenant', organizacionId }, async (): Promise<Awaited<T>> => await fn());
}

/**
 * Salta el filtro multiempresa. Solo para operaciones de plataforma (superadmin, worker, auth).
 * Exige un `motivo` no vacío (p. ej. 'auth.login'): cada salto del aislamiento tiene que poder explicarse.
 */
export async function ejecutarComoPlataforma<T>(motivo: string, fn: () => T): Promise<Awaited<T>> {
  const motivoLimpio = motivo.trim();
  if (!motivoLimpio) throw new Error('ejecutarComoPlataforma exige un motivo no vacío');
  return almacen.run({ modo: 'plataforma', motivo: motivoLimpio }, async (): Promise<Awaited<T>> => await fn());
}

export function contextoActual(): ContextoEmpresa | undefined {
  return almacen.getStore();
}
