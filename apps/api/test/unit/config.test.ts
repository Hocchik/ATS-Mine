import { describe, expect, it } from 'vitest';
import { cargarConfig } from '../../src/config';

describe('cargarConfig', () => {
  it('aplica valores por defecto', () => {
    const c = cargarConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/x' });
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe('development');
    expect(c.LOG_LEVEL).toBe('info');
  });

  it('convierte PORT a número', () => {
    const c = cargarConfig({ DATABASE_URL: 'postgresql://x', PORT: '8080' });
    expect(c.PORT).toBe(8080);
  });

  it('falla si falta DATABASE_URL, nombrando la variable', () => {
    expect(() => cargarConfig({})).toThrow(/DATABASE_URL/);
  });
});
