import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generarToken, hashToken } from '../../src/auth/tokens-aleatorios';

describe('tokens aleatorios', () => {
  it('token base64url de 43 caracteres y hash sha256 hex', () => {
    const { token, hash } = generarToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashToken(token)).toBe(hash);
  });

  it('dos tokens son distintos', () => {
    expect(generarToken().token).not.toBe(generarToken().token);
  });
});
