import { getRounds } from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const espias = vi.hoisted(() => ({ hash: vi.fn() }));
vi.mock('bcryptjs', async (importOriginal) => {
  const original = await importOriginal<typeof import('bcryptjs')>();
  espias.hash.mockImplementation(original.hash);
  return { ...original, hash: espias.hash };
});

const { COSTO_BCRYPT, HASH_SENUELO, hashearContrasena, verificarContrasena } = await import(
  '../../src/auth/contrasenas'
);

beforeEach(() => {
  espias.hash.mockClear();
});

describe('contrasenas', () => {
  it('hashea con bcrypt y verifica', async () => {
    const h = await hashearContrasena('secreta-123', 4);
    expect(h.startsWith('$2')).toBe(true);
    expect(await verificarContrasena('secreta-123', h)).toBe(true);
    expect(await verificarContrasena('otra', h)).toBe(false);
  });

  it('el señuelo es un hash bcrypt constante con el costo de producción', () => {
    expect(HASH_SENUELO).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
    expect(getRounds(HASH_SENUELO)).toBe(COSTO_BCRYPT);
  });

  it('hash nulo da false comparando contra el señuelo, sin hashear en tiempo de ejecución', async () => {
    expect(await verificarContrasena('lo-que-sea', null)).toBe(false);
    expect(await verificarContrasena('lo-que-sea', null)).toBe(false);
    expect(espias.hash).not.toHaveBeenCalled();
  });
});
