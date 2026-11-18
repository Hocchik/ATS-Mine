import { randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';

export const COOKIE_SESION = 'criterio_sesion';
export const COOKIE_CSRF = 'criterio_csrf';

const DURACION_MS = 12 * 3600 * 1000;

const base = (segura: boolean): CookieOptions => ({ sameSite: 'lax', path: '/', secure: segura });

/**
 * Emite la sesión (httpOnly) y el token CSRF de doble envío (legible por el frontend, que lo reenvía en una cabecera).
 * Devuelve el token CSRF generado.
 */
export function emitirSesion(res: Response, { token, segura }: { token: string; segura: boolean }): { csrf: string } {
  const csrf = randomBytes(32).toString('base64url');
  res.cookie(COOKIE_SESION, token, { ...base(segura), httpOnly: true, maxAge: DURACION_MS });
  res.cookie(COOKIE_CSRF, csrf, { ...base(segura), httpOnly: false, maxAge: DURACION_MS });
  return { csrf };
}

export function limpiarSesion(res: Response, { segura }: { segura: boolean }): void {
  res.clearCookie(COOKIE_SESION, { ...base(segura), httpOnly: true });
  res.clearCookie(COOKIE_CSRF, { ...base(segura), httpOnly: false });
}
