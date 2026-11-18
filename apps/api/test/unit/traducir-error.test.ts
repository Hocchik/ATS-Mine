import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/http/errores';
import { traducirError } from '../../src/http/traducir-error';
import { SinContextoTenantError } from '../../src/tenant/extension';
import { ViolacionMultiempresaError } from '../../src/tenant/relaciones';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '6' });

describe('traducirError', () => {
  it('deja pasar un AppError', () => {
    const e = new AppError('VERSION_CONFLICT', 'otra persona lo cambió');
    expect(traducirError(e)).toBe(e);
  });

  it('ZodError → VALIDATION_FAILED con detalle por campo', () => {
    const r = z.object({ email: z.string().email() }).safeParse({ email: 'no' });
    const e = traducirError(r.error);
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.details).toEqual([{ ruta: 'email', mensaje: expect.any(String) }]);
  });

  it.each([
    ['P2002', 'DUPLICATE'],
    ['P2025', 'NOT_FOUND'],
    ['P2003', 'HAS_DEPENDENCIES'],
  ] as const)('Prisma %s → %s', (codigoPrisma, esperado) => {
    expect(traducirError(prismaError(codigoPrisma)).code).toBe(esperado);
  });

  it('JSON mal formado → VALIDATION_FAILED', () => {
    const e = traducirError(Object.assign(new SyntaxError('x'), { type: 'entity.parse.failed' }));
    expect(e.code).toBe('VALIDATION_FAILED');
  });

  it('cuerpo demasiado grande → VALIDATION_FAILED', () => {
    const e = traducirError(Object.assign(new Error('x'), { type: 'entity.too.large' }));
    expect(e.code).toBe('VALIDATION_FAILED');
  });

  it('los errores de la guardia multiempresa → INTERNAL sin filtrar detalles', () => {
    const violacion = traducirError(new ViolacionMultiempresaError('include.membresias: no se puede llegar a Membresia'));
    const sinContexto = traducirError(new SinContextoTenantError('Membresia', 'findMany'));
    for (const e of [violacion, sinContexto]) {
      expect(e.code).toBe('INTERNAL');
      expect(e.message).toBe('Error interno');
    }
  });

  it('cualquier otro error → INTERNAL sin filtrar el mensaje original', () => {
    const e = traducirError(new Error('connection string postgres://secreto'));
    expect(e.code).toBe('INTERNAL');
    expect(e.message).toBe('Error interno');
  });
});
