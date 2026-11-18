import type { Rol } from '@prisma/client';
import type { Request, Response } from 'express';
import type { Seguridad } from '../../app';
import { COOKIE_SESION, emitirSesion } from '../../auth/cookies';
import { firmarSesion, verificarSesion, type ContenidoSesion } from '../../auth/jwt';
import { AppError } from '../../http/errores';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { PrismaTenant } from '../../tenant/extension';

/** Empresa activa tal como la ve el frontend (sin ids de membresía ni versiones). */
export interface EmpresaActivaRespuesta {
  organizacionId: string;
  nombre: string;
  slug: string;
  rol: Rol;
}

/** Firma el JWT y lo deja SOLO en la cookie httpOnly; rota el token CSRF. Nunca devuelve el token. */
export async function emitirSesionFirmada(res: Response, seguridad: Seguridad, contenido: ContenidoSesion): Promise<void> {
  const token = await firmarSesion(contenido, seguridad.jwtSecret);
  emitirSesion(res, { token, segura: seguridad.cookiesSeguras });
}

const NO_AUTENTICADO = 'Inicia sesión para continuar';

/**
 * `versionSesion` del token de la cookie (el resolver ya lo validó, quizá desde su caché). Se reutiliza al volver a
 * firmar, y se exige igual al de la base: un token invalidado nunca obtiene uno nuevo con la versión vigente.
 */
export async function versionSesionVigente(
  req: Request,
  deps: { prisma: PrismaTenant; seguridad: Seguridad; motivo: string },
  usuarioId: string,
): Promise<number> {
  const token: unknown = req.cookies?.[COOKIE_SESION];
  const contenido = typeof token === 'string' ? await verificarSesion(token, deps.seguridad.jwtSecret) : null;
  const usuario = await ejecutarComoPlataforma(deps.motivo, () =>
    deps.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { versionSesion: true } }),
  );
  if (!contenido || contenido.usuarioId !== usuarioId || usuario?.versionSesion !== contenido.versionSesion) {
    throw new AppError('UNAUTHENTICATED', NO_AUTENTICADO);
  }
  return contenido.versionSesion;
}
