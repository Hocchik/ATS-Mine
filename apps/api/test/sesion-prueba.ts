import type { ResolverSesion } from '../src/http/sesion';

/** SOLO PRUEBAS. Simula una sesión a partir de cabeceras. La Fase 1 la reemplaza por la cookie real. */
export const resolverPrueba: ResolverSesion = async (req) => {
  const usuarioId = req.header('x-prueba-usuario');
  const organizacionId = req.header('x-prueba-org');
  if (!usuarioId || !organizacionId) return null;
  return { usuarioId, organizacionId, rol: 'OWNER' };
};

export function cabecerasDeSesion(ids: { usuarioId: string; organizacionId: string }) {
  return { 'x-prueba-usuario': ids.usuarioId, 'x-prueba-org': ids.organizacionId };
}
