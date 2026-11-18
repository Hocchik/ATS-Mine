import { describe, expect, it } from 'vitest';
import { CacheTTL } from '../../src/auth/cache-ttl';

const tamano = (c: CacheTTL<unknown, unknown>) => (c as unknown as { entradas: Map<unknown, unknown> }).entradas.size;

describe('CacheTTL', () => {
  it('vence al cumplirse el TTL', () => {
    let t = 1000;
    const c = new CacheTTL<string, number>(100, () => t);
    c.guardar('a', 1);
    expect(c.obtener('a')).toBe(1);
    t = 1099;
    expect(c.obtener('a')).toBe(1);
    t = 1100;
    expect(c.obtener('a')).toBeUndefined();
  });

  it('borrar y limpiar', () => {
    const c = new CacheTTL<string, number>(100, () => 0);
    c.guardar('a', 1);
    c.guardar('b', 2);
    c.borrar('a');
    expect(c.obtener('a')).toBeUndefined();
    expect(c.obtener('b')).toBe(2);
    c.limpiar();
    expect(c.obtener('b')).toBeUndefined();
  });

  it.each([Number.NaN, 0, -5, Number.POSITIVE_INFINITY])('rechaza un TTL inválido (%s)', (ttl) => {
    expect(() => new CacheTTL<string, number>(ttl)).toThrow();
  });

  it('cada 100 escrituras barre las entradas vencidas', () => {
    let t = 0;
    const c = new CacheTTL<string, number>(100, () => t);
    for (let i = 0; i < 50; i++) c.guardar(`viejo-${i}`, i);
    t = 200;
    for (let i = 0; i < 49; i++) c.guardar(`nuevo-${i}`, i);
    expect(tamano(c)).toBe(99);
    c.guardar('nuevo-49', 49);
    expect(tamano(c)).toBe(50);
    expect(c.obtener('nuevo-0')).toBe(0);
  });
});
