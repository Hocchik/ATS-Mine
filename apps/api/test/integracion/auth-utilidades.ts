import type { Response } from 'supertest';
import { crearApp, type Seguridad } from '../../src/app';
import { hashearContrasena } from '../../src/auth/contrasenas';
import { COOKIE_CSRF } from '../../src/auth/cookies';
import { crearResolverSesion } from '../../src/auth/resolver-sesion';
import { crearLogger } from '../../src/logger';
import { modulosDeLaApp } from '../../src/modulos';
import { extenderConTenant } from '../../src/tenant/extension';
import { prismaPrueba } from '../db';
import { crearUsuario } from '../fabricas';
import { SECRETO_PRUEBA, SEGURIDAD_PRUEBA } from '../sesion-real';

export const CONTRASENA = 'una-contrasena-larga';

/** App real (todos los módulos y el resolver real) con limitadores nuevos en cada llamada. */
export function appAuth(seguridad: Seguridad = SEGURIDAD_PRUEBA) {
  const prisma = extenderConTenant(prismaPrueba);
  const sesiones = crearResolverSesion({ prisma, secreto: SECRETO_PRUEBA });
  return crearApp({
    logger: crearLogger('silent'),
    resolverSesion: sesiones.resolver,
    seguridad,
    modulos: modulosDeLaApp({ prisma, sesiones, seguridad }),
  }).app;
}

function lineasSetCookie(res: Response): string[] {
  const valor = res.headers['set-cookie'] as string[] | string | undefined;
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

/** Línea completa de `Set-Cookie` de esa cookie (con atributos), o undefined. */
export function lineaCookie(res: Response, nombre: string): string | undefined {
  return lineasSetCookie(res).find((l) => l.startsWith(`${nombre}=`));
}

/** Valor de la cookie emitida en la respuesta, o undefined. */
export function valorCookie(res: Response, nombre: string): string | undefined {
  const linea = lineaCookie(res, nombre);
  return linea?.slice(nombre.length + 1).split(';')[0];
}

export const csrfDe = (res: Response): string => {
  const csrf = valorCookie(res, COOKIE_CSRF);
  if (!csrf) throw new Error('La respuesta no emitió la cookie CSRF');
  return csrf;
};

/** Persona con contraseña conocida (bcrypt de costo 4 para que las pruebas sean rápidas). */
export async function personaConContrasena(contrasena = CONTRASENA) {
  const base = await crearUsuario();
  return prismaPrueba.usuario.update({
    where: { id: base.id },
    data: { passwordHash: await hashearContrasena(contrasena, 4) },
  });
}
