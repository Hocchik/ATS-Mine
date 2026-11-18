import { describe, expect, it } from 'vitest';
import { CODIGOS_ERROR, respuestaErrorSchema } from './errores';

describe('respuestaErrorSchema', () => {
  it('acepta una respuesta de error válida', () => {
    const r = respuestaErrorSchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'No existe', requestId: 'abc' },
    });
    expect(r.success).toBe(true);
  });

  it('acepta details opcional', () => {
    const r = respuestaErrorSchema.safeParse({
      error: { code: 'VALIDATION_FAILED', message: 'x', requestId: 'abc', details: [{ ruta: 'email' }] },
    });
    expect(r.success).toBe(true);
  });

  it('rechaza un código fuera del catálogo', () => {
    const r = respuestaErrorSchema.safeParse({
      error: { code: 'OOPS', message: 'x', requestId: 'abc' },
    });
    expect(r.success).toBe(false);
  });

  it('exige requestId', () => {
    const r = respuestaErrorSchema.safeParse({ error: { code: 'INTERNAL', message: 'x' } });
    expect(r.success).toBe(false);
  });

  it('no tiene códigos duplicados', () => {
    expect(new Set(CODIGOS_ERROR).size).toBe(CODIGOS_ERROR.length);
  });
});
