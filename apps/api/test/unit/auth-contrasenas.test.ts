import { describe, expect, it } from 'vitest';
import { hashearContrasena, verificarContrasena } from '../../src/auth/contrasenas';

describe('contrasenas', () => {
  it('hashea con bcrypt y verifica', async () => {
    const h = await hashearContrasena('secreta-123', 4);
    expect(h.startsWith('$2')).toBe(true);
    expect(await verificarContrasena('secreta-123', h)).toBe(true);
    expect(await verificarContrasena('otra', h)).toBe(false);
  });

  it('hash nulo da false usando el señuelo', async () => {
    expect(await verificarContrasena('lo-que-sea', null)).toBe(false);
  });
});
