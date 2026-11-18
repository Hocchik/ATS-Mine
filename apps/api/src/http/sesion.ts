import type { Request, RequestHandler, Response } from 'express';
import type { Rol } from '@prisma/client';
import { contextoActual, ejecutarEnTenant } from '../tenant/contexto';
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

/** Empresa activa de la cookie en rutas AUTENTICADA/PLATAFORMA: solo informativa, nunca para filtrar consultas. */
export interface EmpresaActiva {
  organizacionId: string;
  membresiaId: string;
  rol: Rol;
}

const NO_AUTENTICADO = 'Inicia sesión para continuar';
const SIN_EMPRESA = 'Elige una empresa para continuar';
const SIN_PERMISO = 'No tienes permiso para esta acción';

/**
 * Exige sesión. Guarda en `res.locals.sesion` solo la parte de usuario: fuera de `ejecutarEnTenant` ningún handler
 * obtiene un `organizacionId` de la sesión. La empresa activa queda aparte, en `res.locals.empresaActiva`.
 */
export function exigirAutenticado(resolver: ResolverSesion): RequestHandler {
  return async (req, res, next) => {
    const sesion = await resolver(req);
    if (!sesion) throw new AppError('UNAUTHENTICATED', NO_AUTENTICADO);
    const usuario: SesionUsuario = { usuarioId: sesion.usuarioId, esSuperadmin: sesion.esSuperadmin };
    res.locals.sesion = usuario;
    res.locals.empresaActiva = tieneEmpresa(sesion)
      ? ({ organizacionId: sesion.organizacionId, membresiaId: sesion.membresiaId, rol: sesion.rol } satisfies EmpresaActiva)
      : null;
    next();
  };
}

/** Exige empresa activa y promueve la sesión a SesionEmpresa (va antes de `correrEnTenant`). */
export const exigirEmpresa: RequestHandler = (_req, res, next) => {
  const usuario = obtenerSesion(res);
  const empresa = obtenerEmpresaActivaOpcional(res);
  if (!empresa) throw new AppError('SIN_EMPRESA', SIN_EMPRESA);
  res.locals.sesion = { ...usuario, ...empresa } satisfies SesionEmpresa;
  next();
};

/** Sin roles: cualquier miembro. Con roles: el de la membresía tiene que estar en la lista. */
export function exigirRol(roles: readonly Rol[] | undefined): RequestHandler {
  return (_req, res, next) => {
    const sesion = res.locals.sesion as Sesion | undefined;
    if (!sesion || !tieneEmpresa(sesion)) throw new AppError('SIN_EMPRESA', SIN_EMPRESA);
    if (roles && !roles.includes(sesion.rol)) throw new AppError('FORBIDDEN', SIN_PERMISO);
    next();
  };
}

export const exigirSuperadmin: RequestHandler = (_req, res, next) => {
  if (!obtenerSesion(res).esSuperadmin) throw new AppError('FORBIDDEN', SIN_PERMISO);
  next();
};

/** Corre el resto de la cadena en el contexto de la empresa de la sesión. */
export const correrEnTenant: RequestHandler = (_req, res, next) => {
  const sesion = res.locals.sesion as Sesion | undefined;
  if (!sesion || !tieneEmpresa(sesion)) throw new AppError('SIN_EMPRESA', SIN_EMPRESA);
  return ejecutarEnTenant(sesion.organizacionId, () => next());
};

export function obtenerSesion(res: Response): Sesion {
  const sesion = res.locals.sesion as Sesion | undefined;
  if (!sesion) throw new AppError('UNAUTHENTICATED', NO_AUTENTICADO);
  return sesion;
}

/** Solo dentro del contexto de empresa de esa misma sesión (rutas TENANT); en cualquier otro lado, SIN_EMPRESA. */
export function obtenerSesionEmpresa(res: Response): SesionEmpresa {
  const sesion = obtenerSesion(res);
  const contexto = contextoActual();
  const enSuEmpresa =
    tieneEmpresa(sesion) && contexto?.modo === 'tenant' && contexto.organizacionId === sesion.organizacionId.toLowerCase();
  if (!enSuEmpresa) throw new AppError('SIN_EMPRESA', SIN_EMPRESA);
  return sesion as SesionEmpresa;
}

/** Empresa activa de la cookie (o null). Solo informativa: para consultas por empresa, usa una ruta TENANT. */
export function obtenerEmpresaActivaOpcional(res: Response): EmpresaActiva | null {
  return (res.locals.empresaActiva as EmpresaActiva | null | undefined) ?? null;
}
