import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/errores';

describe('AppError', () => {
  it.each([
    ['VALIDATION_FAILED', 400],
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['VERSION_CONFLICT', 409],
    ['VACANTE_CERRADA', 410],
    ['RATE_LIMITED', 429],
    ['INTERNAL', 500],
  ] as const)('%s → %i', (codigo, status) => {
    expect(new AppError(codigo, 'x').status).toBe(status);
  });

  it('guarda details', () => {
    expect(new AppError('VALIDATION_FAILED', 'x', [{ ruta: 'a' }]).details).toEqual([{ ruta: 'a' }]);
  });
});
