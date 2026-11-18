import type { Request, RequestHandler, Response } from 'express';
import type { Rol } from '@prisma/client';
import { ejecutarEnTenant } from '../tenant/contexto';
import { AppError } from './errores';

/** Persona autenticada, todavía sin empresa activa (onboarding, "mis empresas"). */
export interface SesionUsuario {
  usuarioId: string;
  esSuperadmin: boolean;
}

/** Persona autenticada con una empresa activa y una membresía vigente en ella. */
export interface SesionEmpresa extends SesionUsuario {
  organizacionId: string;
  membresiaId: string;
  rol: Rol;
}

export type Sesion = SesionUsuario | SesionEmpresa;

export const tieneEmpresa = (s: Sesion): s is SesionEmpresa => 'organizacionId' in s;

/** Obtiene la sesión de la petición (cookie + versiones vigentes; ver auth/resolver-sesion.ts). */
export type ResolverSesion = (req: Request) => Promise<Sesion | null>;

/** Resolver nulo: nadie tiene sesión. */
export const sinSesion: ResolverSesion = async () => null;

const NO_AUTENTICADO = 'Inicia sesión para continuar';
const SIN_EMPRESA = 'Elige una empresa para continuar';

/** Exige una sesión con empresa y corre el resto de la cadena en el contexto de esa empresa. */
export function exigirTenant(resolver: ResolverSesion): RequestHandler {
  return async (req, res, next) => {
    const sesion = await resolver(req);
    if (!sesion) throw new AppError('UNAUTHENTICATED', NO_AUTENTICADO);
    if (!tieneEmpresa(sesion)) throw new AppError('SIN_EMPRESA', SIN_EMPRESA);
    res.locals.sesion = sesion;
    return ejecutarEnTenant(sesion.organizacionId, () => next());
  };
}

export function obtenerSesion(res: Response): Sesion {
  const sesion = res.locals.sesion as Sesion | undefined;
  if (!sesion) throw new AppError('UNAUTHENTICATED', NO_AUTENTICADO);
  return sesion;
}

export function obtenerSesionEmpresa(res: Response): SesionEmpresa {
  const sesion = obtenerSesion(res);
  if (!tieneEmpresa(sesion)) throw new AppError('SIN_EMPRESA', SIN_EMPRESA);
  return sesion;
}
