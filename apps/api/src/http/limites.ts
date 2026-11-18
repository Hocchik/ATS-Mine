import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { ipCliente } from './edge';
import { AppError } from './errores';

export interface OpcionesLimitador {
  ventanaMs: number;
  maximo: number;
  /** Clave de conteo; por defecto la IP real del cliente. */
  clave?: (req: Request, res: Response) => string;
}

/** Limitador con almacén en memoria propio y respuesta 429 en el formato de error de la API. */
export function crearLimitador({ ventanaMs, maximo, clave }: OpcionesLimitador): RequestHandler {
  return rateLimit({
    windowMs: ventanaMs,
    limit: maximo,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // IPv6: agrupa por subred /56 para que rotar la parte baja de la dirección no evada el límite.
    keyGenerator: (req, res) => (clave ? clave(req, res) : ipKeyGenerator(ipCliente(req, res))),
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Demasiados intentos, espera un momento'));
    },
  });
}
