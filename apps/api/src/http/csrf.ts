import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { COOKIE_CSRF } from '../auth/cookies';
import { AppError } from './errores';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MENSAJE = 'La solicitud no pudo verificarse; recarga la página e inténtalo de nuevo';

const esTextoNoVacio = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const resumen = (v: string): Buffer => createHash('sha256').update(v, 'utf8').digest();

/**
 * Compara en tiempo constante los SHA-256 de ambos valores: siempre 32 bytes, así un texto no ASCII (con otro largo
 * en bytes) nunca hace lanzar a timingSafeEqual. Solo strings no vacíos llegan a compararse.
 */
function sonIguales(a: unknown, b: unknown): boolean {
  if (!esTextoNoVacio(a) || !esTextoNoVacio(b)) return false;
  return timingSafeEqual(resumen(a), resumen(b));
}

/**
 * Toda la app (también rutas PUBLICA: evita el CSRF de login): en un método que modifica datos, si viene `Origin`
 * tiene que ser `webOrigin`. Sin `Origin` pasa (clientes que no son navegadores: worker, health checks).
 */
export function verificarOrigen(webOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (METODOS_SEGUROS.has(req.method)) return next();
    const origen = req.header('origin');
    if (origen !== undefined && origen !== webOrigin) throw new AppError('CSRF_INVALIDO', MENSAJE);
    next();
  };
}

/**
 * Rutas con sesión, solo en métodos que modifican datos: `Origin` OBLIGATORIO e igual a `webOrigin`, y la cabecera
 * `X-CSRF-Token` igual a la cookie `criterio_csrf` (cookie-parser puede entregar objetos con valores `j:{...}`:
 * cualquier cosa que no sea un string no vacío se rechaza).
 */
export function verificarCsrf(webOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (METODOS_SEGUROS.has(req.method)) return next();
    if (req.header('origin') !== webOrigin) throw new AppError('CSRF_INVALIDO', MENSAJE);
    const cookies = req.cookies as Record<string, unknown> | undefined;
    if (!sonIguales(req.header('x-csrf-token'), cookies?.[COOKIE_CSRF])) throw new AppError('CSRF_INVALIDO', MENSAJE);
    next();
  };
}
