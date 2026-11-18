import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from './errores';

function tipoDeErrorDeCuerpo(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'type' in err && typeof err.type === 'string') return err.type;
  return undefined;
}

/** 22021 (byte inválido para UTF8, p. ej. NUL) y 22P05 (carácter sin equivalente): llegan en el mensaje o en meta. */
const CODIGOS_TEXTO_INVALIDO = ['22021', '22P05'];

function esTextoInvalidoDePostgres(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientUnknownRequestError)) {
    return false;
  }
  const meta = err instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(err.meta ?? {}) : '';
  const texto = `${err.message} ${meta}`;
  return CODIGOS_TEXTO_INVALIDO.some((c) => texto.includes(c)) || /invalid byte sequence for encoding/i.test(texto);
}

export function traducirError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const detalles = err.issues.map((i) => ({ ruta: i.path.join('.'), mensaje: i.message }));
    return new AppError('VALIDATION_FAILED', 'Datos inválidos', detalles);
  }

  if (esTextoInvalidoDePostgres(err)) return new AppError('VALIDATION_FAILED', 'Texto con caracteres no válidos');

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return new AppError('DUPLICATE', 'Ya existe un registro con esos datos');
    if (err.code === 'P2025') return new AppError('NOT_FOUND', 'No encontrado');
    if (err.code === 'P2003') return new AppError('HAS_DEPENDENCIES', 'Hay datos relacionados que impiden la operación');
  }

  const tipo = tipoDeErrorDeCuerpo(err);
  if (tipo === 'entity.parse.failed') return new AppError('VALIDATION_FAILED', 'El cuerpo no es JSON válido');
  if (tipo === 'entity.too.large') return new AppError('VALIDATION_FAILED', 'El cuerpo es demasiado grande');

  return new AppError('INTERNAL', 'Error interno');
}
