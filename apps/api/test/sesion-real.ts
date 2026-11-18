import { COOKIE_SESION } from '../src/auth/cookies';
import { firmarSesion, type ContenidoSesion } from '../src/auth/jwt';

/** SOLO PRUEBAS. Secreto fijo con el que se firman las sesiones reales de las pruebas. */
export const SECRETO_PRUEBA = 'secreto-de-prueba-fijo-para-sesiones-0123456789';

/** Firma un JWT real y lo devuelve como valor de la cabecera `Cookie`. */
export async function cookieDeSesion(
  contenido: ContenidoSesion,
  opciones: { secreto?: string; ahora?: Date } = {},
): Promise<string> {
  const token = await firmarSesion(contenido, opciones.secreto ?? SECRETO_PRUEBA, opciones.ahora);
  return `${COOKIE_SESION}=${token}`;
}

/** Contenido de sesión con empresa a partir de una membresía de la base. */
export function contenidoConEmpresa(
  usuario: { id: string; versionSesion: number },
  membresia: { id: string; organizacionId: string; version: number },
): ContenidoSesion {
  return {
    usuarioId: usuario.id,
    versionSesion: usuario.versionSesion,
    empresa: { organizacionId: membresia.organizacionId, membresiaId: membresia.id, versionMembresia: membresia.version },
  };
}
