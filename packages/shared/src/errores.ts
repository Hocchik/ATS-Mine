import { z } from 'zod';

export const CODIGOS_ERROR = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'DUPLICATE',
  'HAS_DEPENDENCIES',
  'VACANTE_CERRADA',
  'ORG_NO_VERIFICADA',
  'RATE_LIMITED',
  'CAPTCHA_FAILED',
  'ARCHIVO_INVALIDO',
  'YA_POSTULASTE',
  'INTERNAL',
] as const;

export const codigoErrorSchema = z.enum(CODIGOS_ERROR);
export type CodigoError = z.infer<typeof codigoErrorSchema>;

export const respuestaErrorSchema = z.object({
  error: z.object({
    code: codigoErrorSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
    requestId: z.string().min(1),
  }),
});
export type RespuestaError = z.infer<typeof respuestaErrorSchema>;
