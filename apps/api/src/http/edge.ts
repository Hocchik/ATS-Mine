import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from './errores';

const CABECERA_EDGE = 'x-criterio-edge';

const digerir = (valor: string) => createHash('sha256').update(valor).digest();

/**
 * Compara digests de largo fijo: no depende del largo en caracteres (los no ASCII cambian el largo en bytes y
 * harían lanzar a timingSafeEqual) y no revela el largo del secreto.
 */
function coincide(recibido: unknown, esperado: string): boolean {
  if (typeof recibido !== 'string' || recibido.length === 0) return false;
  return timingSafeEqual(digerir(recibido), digerir(esperado));
}

/**
 * Exige que `/api` llegue por el edge (proxy de Vercel) que conoce el secreto compartido. Sin secreto
 * configurado (desarrollo y pruebas) deja pasar sin marcar la petición como verificada.
 * No registrar nunca el valor de la cabecera.
 */
export function exigirEdge(edgeSecret?: string): RequestHandler {
  return (req, res, next) => {
    if (edgeSecret === undefined) {
      res.locals.edgeVerificado = false;
      next();
      return;
    }
    if (!coincide(req.headers[CABECERA_EDGE], edgeSecret)) {
      next(new AppError('FORBIDDEN', 'Acceso no permitido'));
      return;
    }
    res.locals.edgeVerificado = true;
    next();
  };
}

function primerValor(cabecera: string | string[] | undefined): string | undefined {
  const valor = Array.isArray(cabecera) ? cabecera[0] : cabecera;
  const primero = valor?.split(',')[0]?.trim();
  return primero ? primero : undefined;
}

/** IP real del cliente. Las cabeceras del edge solo se creen si el secreto del edge se verificó. */
export function ipCliente(req: Request, res: Response): string {
  if (res.locals.edgeVerificado === true) {
    const delEdge = primerValor(req.headers['x-vercel-forwarded-for']) ?? primerValor(req.headers['x-real-ip']);
    if (delEdge) return delEdge;
  }
  return req.ip ?? 'desconocida';
}
