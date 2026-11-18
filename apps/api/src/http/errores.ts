import type { CodigoError } from '@criterio/shared';

const STATUS_POR_CODIGO: Record<CodigoError, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  DUPLICATE: 409,
  HAS_DEPENDENCIES: 409,
  VACANTE_CERRADA: 410,
  ORG_NO_VERIFICADA: 403,
  RATE_LIMITED: 429,
  CAPTCHA_FAILED: 400,
  ARCHIVO_INVALIDO: 400,
  YA_POSTULASTE: 409,
  CREDENCIALES_INVALIDAS: 401,
  CSRF_INVALIDO: 403,
  SIN_EMPRESA: 403,
  TOKEN_INVALIDO: 400,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  readonly code: CodigoError;
  readonly details: unknown;

  constructor(code: CodigoError, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_POR_CODIGO[code];
    this.details = details;
  }
}
