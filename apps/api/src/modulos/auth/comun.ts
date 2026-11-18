import type { Rol } from '@prisma/client';
import type { Response } from 'express';
import type { Seguridad } from '../../app';
import { emitirSesion } from '../../auth/cookies';
import { firmarSesion, type ContenidoSesion } from '../../auth/jwt';

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
