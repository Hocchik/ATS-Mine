import type { RespuestaError } from '@criterio/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from './errores';
import { traducirError } from './traducir-error';

export const rutaNoEncontrada: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Ruta no encontrada'));
};

export const manejadorErrores: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const error = traducirError(err);
  if (error.status >= 500) req.log.error({ err }, 'error no controlado');
  const cuerpo: RespuestaError = {
    error: {
      code: error.code,
      message: error.message,
      requestId: String(req.id),
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
  res.status(error.status).json(cuerpo);
};
