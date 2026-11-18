import { randomBytes } from 'node:crypto';
import { COOKIE_CSRF, COOKIE_SESION } from '../src/auth/cookies';
import { firmarSesion, type ContenidoSesion } from '../src/auth/jwt';
import { prismaPrueba } from './db';
import { crearMembresia } from './fabricas';

/** SOLO PRUEBAS. Secreto fijo con el que se firman las sesiones reales de las pruebas. */
export const SECRETO_PRUEBA = 'secreto-de-prueba-fijo-para-sesiones-0123456789';

/** SOLO PRUEBAS. Origen web permitido (`webOrigin`) en las apps de prueba. */
export const ORIGEN_PRUEBA = 'http://localhost:5173';

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

/**
 * Cabeceras de una sesión real (cookie firmada con SECRETO_PRUEBA) más el CSRF de doble envío y `Origin`.
 * Con `organizacionId`, usa la membresía existente o crea una OWNER si no hay.
 */
export async function cabecerasDeSesionReal(ids: {
  usuarioId: string;
  organizacionId?: string;
}): Promise<Record<string, string>> {
  const usuario = await prismaPrueba.usuario.findUniqueOrThrow({ where: { id: ids.usuarioId } });
  let contenido: ContenidoSesion = { usuarioId: usuario.id, versionSesion: usuario.versionSesion };
  if (ids.organizacionId) {
    const existente = await prismaPrueba.membresia.findUnique({
      where: { usuarioId_organizacionId: { usuarioId: usuario.id, organizacionId: ids.organizacionId } },
    });
    const membresia = existente ?? (await crearMembresia(usuario.id, ids.organizacionId, 'OWNER'));
    contenido = contenidoConEmpresa(usuario, membresia);
  }
  const csrf = randomBytes(32).toString('base64url');
  return {
    Cookie: `${await cookieDeSesion(contenido)}; ${COOKIE_CSRF}=${csrf}`,
    'X-CSRF-Token': csrf,
    Origin: ORIGEN_PRUEBA,
  };
}

/** SOLO PRUEBAS. Seguridad de `crearApp`: sin secreto de edge y con cookies no seguras (http local). */
export const SEGURIDAD_PRUEBA = {
  jwtSecret: SECRETO_PRUEBA,
  webOrigin: ORIGEN_PRUEBA,
  cookiesSeguras: false,
};
