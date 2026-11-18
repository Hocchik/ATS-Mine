import type { ResolverSesion } from '../src/http/sesion';

/** Membresía ficticia: las pruebas que usan este resolver no la consultan. */
const MEMBRESIA_PRUEBA = '00000000-0000-4000-8000-0000000000aa';

/** SOLO PRUEBAS. Simula una sesión con empresa a partir de cabeceras (la real está en test/sesion-real.ts). */
export const resolverPrueba: ResolverSesion = async (req) => {
  const usuarioId = req.header('x-prueba-usuario');
  const organizacionId = req.header('x-prueba-org');
  if (!usuarioId || !organizacionId) return null;
  return { usuarioId, esSuperadmin: false, organizacionId, membresiaId: MEMBRESIA_PRUEBA, rol: 'OWNER' };
};

export function cabecerasDeSesion(ids: { usuarioId: string; organizacionId: string }) {
  return { 'x-prueba-usuario': ids.usuarioId, 'x-prueba-org': ids.organizacionId };
}
