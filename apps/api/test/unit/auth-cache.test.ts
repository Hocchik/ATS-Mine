import { describe, expect, it } from 'vitest';
import { CacheTTL } from '../../src/auth/cache-ttl';

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
});
