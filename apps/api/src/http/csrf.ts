import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { COOKIE_CSRF } from '../auth/cookies';
import { AppError } from './errores';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MENSAJE = 'La solicitud no pudo verificarse; recarga la página e inténtalo de nuevo';

const esTextoNoVacio = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Compara en tiempo constante; solo strings no vacíos y buffers del mismo largo llegan a timingSafeEqual. */
function sonIguales(a: unknown, b: unknown): boolean {
  if (!esTextoNoVacio(a) || !esTextoNoVacio(b)) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * CSRF de doble envío + Origin, solo en métodos que modifican datos. Si viene `Origin`, debe ser `webOrigin`;
 * la cabecera `X-CSRF-Token` debe ser igual a la cookie `criterio_csrf` (cookie-parser puede entregar objetos
 * con valores `j:{...}`: cualquier cosa que no sea un string no vacío se rechaza).
 */
export function verificarCsrf(webOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (METODOS_SEGUROS.has(req.method)) return next();
    const origen = req.header('origin');
    if (origen !== undefined && origen !== webOrigin) throw new AppError('CSRF_INVALIDO', MENSAJE);
    const cookies = req.cookies as Record<string, unknown> | undefined;
    if (!sonIguales(req.header('x-csrf-token'), cookies?.[COOKIE_CSRF])) throw new AppError('CSRF_INVALIDO', MENSAJE);
    next();
  };
}
