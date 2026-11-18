import type { Request, RequestHandler, Response } from 'express';
import type { Rol } from '@prisma/client';
import { ejecutarEnTenant } from '../tenant/contexto';
import { AppError } from './errores';

export interface Sesion {
  usuarioId: string;
  organizacionId: string;
  rol: Rol;
}

/** Obtiene la sesión de la petición. La Fase 1 implementa la versión real (cookie + membresía). */
export type ResolverSesion = (req: Request) => Promise<Sesion | null>;

/** Resolver de producción hasta la Fase 1: nadie tiene sesión. */
export const sinSesion: ResolverSesion = async () => null;

export function exigirTenant(resolver: ResolverSesion): RequestHandler {
  return async (req, res, next) => {
    const sesion = await resolver(req);
    if (!sesion) throw new AppError('UNAUTHENTICATED', 'Inicia sesión para continuar');
    res.locals.sesion = sesion;
    return ejecutarEnTenant(sesion.organizacionId, () => next());
  };
}

export function obtenerSesion(res: Response): Sesion {
  const sesion = res.locals.sesion as Sesion | undefined;
  if (!sesion) throw new AppError('UNAUTHENTICATED', 'Inicia sesión para continuar');
  return sesion;
}
