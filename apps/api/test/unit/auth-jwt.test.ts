import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { firmarSesion, verificarSesion } from '../../src/auth/jwt';

const S = 'secreto-de-prueba-con-longitud-suficiente-123';
const clave = (s: string) => new TextEncoder().encode(s);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const U = randomUUID();
const O = randomUUID();
const M = randomUUID();

/** Token firmado directamente con jose, para construir lo que firmarSesion nunca emitiría. */
async function tokenManual(
  claims: Record<string, unknown>,
  opciones: { alg?: string; sub?: string | null; iat?: number | null; exp?: number | null; secreto?: string } = {},
): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: opciones.alg ?? 'HS256' })
    .setIssuer('criterio-api')
    .setAudience('criterio-web');
  const sub = opciones.sub === undefined ? U : opciones.sub;
  if (sub !== null) jwt.setSubject(sub);
  const iat = opciones.iat === undefined ? ahora : opciones.iat;
  if (iat !== null) jwt.setIssuedAt(iat);
  const exp = opciones.exp === undefined ? ahora + 3600 : opciones.exp;
  if (exp !== null) jwt.setExpirationTime(exp);
  return jwt.sign(clave(opciones.secreto ?? S));
}

describe('jwt de sesión', () => {
  it('ida y vuelta sin empresa', async () => {
    const t = await firmarSesion({ usuarioId: U, versionSesion: 2 }, S);
    expect(await verificarSesion(t, S)).toEqual({ usuarioId: U, versionSesion: 2 });
  });

  it('ida y vuelta con empresa', async () => {
    const c = {
      usuarioId: U,
      versionSesion: 2,
      empresa: { organizacionId: O, membresiaId: M, versionMembresia: 3 },
    };
    expect(await verificarSesion(await firmarSesion(c, S), S)).toEqual(c);
  });

  it('el token manual válido se acepta (control de los casos de abajo)', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }), S)).toEqual({ usuarioId: U, versionSesion: 1 });
  });

  it('otro secreto da null', async () => {
    const t = await firmarSesion({ usuarioId: U, versionSesion: 1 }, S);
    expect(await verificarSesion(t, S + 'x')).toBeNull();
  });

  it('vence a las 12 h', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t = await firmarSesion({ usuarioId: U, versionSesion: 1 }, S, t0);
    expect(await verificarSesion(t, S, new Date(t0.getTime() + 11 * 3600_000))).not.toBeNull();
    expect(await verificarSesion(t, S, new Date(t0.getTime() + 12 * 3600_000 + 1000))).toBeNull();
  });

  it('payload alterado da null', async () => {
    const t = await firmarSesion({ usuarioId: U, versionSesion: 1 }, S);
    const [h, p, f] = t.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.sub = randomUUID();
    expect(await verificarSesion(`${h}.${b64(payload)}.${f}`, S)).toBeNull();
  });

  it('iss o aud incorrectos dan null', async () => {
    const base = () => new SignJWT({ sv: 1 }).setProtectedHeader({ alg: 'HS256' }).setSubject(U).setIssuedAt().setExpirationTime('1h');
    const sinNada = await base().sign(clave(S));
    const issMal = await base().setIssuer('otro').setAudience('criterio-web').sign(clave(S));
    const audMal = await base().setIssuer('criterio-api').setAudience('otro').sign(clave(S));
    expect(await verificarSesion(sinNada, S)).toBeNull();
    expect(await verificarSesion(issMal, S)).toBeNull();
    expect(await verificarSesion(audMal, S)).toBeNull();
  });

  it('alg none da null', async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: U, sv: 1, iss: 'criterio-api', aud: 'criterio-web', iat: ahora, exp: ahora + 3600,
    })}.`;
    expect(await verificarSesion(t, S)).toBeNull();
  });

  it('HS512 con el mismo secreto da null (algoritmo fijado)', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { alg: 'HS512' }), S)).toBeNull();
  });

  it('basura da null sin lanzar', async () => {
    expect(await verificarSesion('no-es-un-jwt', S)).toBeNull();
  });
});

describe('claims obligatorios y edad máxima', () => {
  it('sin exp da null', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { exp: null }), S)).toBeNull();
  });

  it('sin iat da null', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { iat: null }), S)).toBeNull();
  });

  it('sin sub da null', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { sub: null }), S)).toBeNull();
  });

  it('sin sv da null', async () => {
    expect(await verificarSesion(await tokenManual({}), S)).toBeNull();
  });

  it('iat en el futuro da null', async () => {
    const ahora = Math.floor(Date.now() / 1000);
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { iat: ahora + 3600, exp: ahora + 7200 }), S)).toBeNull();
  });

  it('exp lejano no alarga la sesión más allá de 12 h desde iat', async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const t = await tokenManual({ sv: 1 }, { iat: ahora - 13 * 3600, exp: ahora + 10 * 365 * 24 * 3600 });
    expect(await verificarSesion(t, S)).toBeNull();
  });
});

describe('valores de los claims', () => {
  it.each([
    ['sv como texto', { sv: '1' }],
    ['sv negativo', { sv: -1 }],
    ['sv cero', { sv: 0 }],
    ['sv fraccionario', { sv: 1.5 }],
    ['solo org', { sv: 1, org: O }],
    ['org y mid sin mv', { sv: 1, org: O, mid: M }],
    ['org nulo', { sv: 1, org: null }],
    ['org no UUID', { sv: 1, org: 'o1', mid: M, mv: 1 }],
    ['mid no UUID', { sv: 1, org: O, mid: 'm1', mv: 1 }],
    ['mv fraccionario', { sv: 1, org: O, mid: M, mv: 1.5 }],
    ['mv negativo', { sv: 1, org: O, mid: M, mv: -2 }],
  ])('%s da null', async (_caso, claims) => {
    expect(await verificarSesion(await tokenManual(claims), S)).toBeNull();
  });

  it('ids en mayúsculas se devuelven canonizados en minúsculas', async () => {
    const t = await tokenManual(
      { sv: 1, org: O.toUpperCase(), mid: M.toUpperCase(), mv: 2 },
      { sub: U.toUpperCase() },
    );
    expect(await verificarSesion(t, S)).toEqual({
      usuarioId: U,
      versionSesion: 1,
      empresa: { organizacionId: O, membresiaId: M, versionMembresia: 2 },
    });
  });

  it('firmarSesion firma los ids en minúsculas', async () => {
    const t = await firmarSesion(
      {
        usuarioId: U.toUpperCase(),
        versionSesion: 1,
        empresa: { organizacionId: O.toUpperCase(), membresiaId: M.toUpperCase(), versionMembresia: 1 },
      },
      S,
    );
    const payload = JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString());
    expect([payload.sub, payload.org, payload.mid]).toEqual([U, O, M]);
  });

  it('sub vacío da null', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { sub: '' }), S)).toBeNull();
  });

  it('sub no UUID da null', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { sub: 'u1' }), S)).toBeNull();
  });
});

describe('secreto corto', () => {
  const corto = 'a'.repeat(31);

  it('firmarSesion lanza con un secreto de menos de 32 caracteres', async () => {
    await expect(firmarSesion({ usuarioId: U, versionSesion: 1 }, corto)).rejects.toThrow();
    await expect(firmarSesion({ usuarioId: U, versionSesion: 1 }, '')).rejects.toThrow();
  });

  it('verificarSesion devuelve null con un secreto de menos de 32 caracteres', async () => {
    expect(await verificarSesion(await tokenManual({ sv: 1 }, { secreto: corto }), corto)).toBeNull();
  });
});

describe('firmarSesion valida lo que firma', () => {
  it.each([
    ['usuarioId no UUID', { usuarioId: 'u1', versionSesion: 1 }],
    ['usuarioId vacío', { usuarioId: '', versionSesion: 1 }],
    ['versionSesion cero', { usuarioId: U, versionSesion: 0 }],
    ['versionSesion fraccionaria', { usuarioId: U, versionSesion: 1.5 }],
    ['versionSesion NaN', { usuarioId: U, versionSesion: Number.NaN }],
    [
      'organizacionId no UUID',
      { usuarioId: U, versionSesion: 1, empresa: { organizacionId: 'o1', membresiaId: M, versionMembresia: 1 } },
    ],
    [
      'membresiaId no UUID',
      { usuarioId: U, versionSesion: 1, empresa: { organizacionId: O, membresiaId: 'm1', versionMembresia: 1 } },
    ],
    [
      'versionMembresia negativa',
      { usuarioId: U, versionSesion: 1, empresa: { organizacionId: O, membresiaId: M, versionMembresia: -1 } },
    ],
  ])('%s lanza', async (_caso, contenido) => {
    await expect(firmarSesion(contenido, S)).rejects.toThrow();
  });
});
