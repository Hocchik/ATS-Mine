import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { firmarSesion, verificarSesion } from '../../src/auth/jwt';

const S = 'secreto-de-prueba-con-longitud-suficiente-123';
const clave = (s: string) => new TextEncoder().encode(s);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('jwt de sesión', () => {
  it('ida y vuelta sin empresa', async () => {
    const t = await firmarSesion({ usuarioId: 'u1', versionSesion: 2 }, S);
    expect(await verificarSesion(t, S)).toEqual({ usuarioId: 'u1', versionSesion: 2 });
  });

  it('ida y vuelta con empresa', async () => {
    const c = {
      usuarioId: 'u1',
      versionSesion: 2,
      empresa: { organizacionId: 'o1', membresiaId: 'm1', versionMembresia: 3 },
    };
    expect(await verificarSesion(await firmarSesion(c, S), S)).toEqual(c);
  });

  it('otro secreto da null', async () => {
    const t = await firmarSesion({ usuarioId: 'u1', versionSesion: 1 }, S);
    expect(await verificarSesion(t, S + 'x')).toBeNull();
  });

  it('vence a las 12 h', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t = await firmarSesion({ usuarioId: 'u1', versionSesion: 1 }, S, t0);
    expect(await verificarSesion(t, S, new Date(t0.getTime() + 11 * 3600_000))).not.toBeNull();
    expect(await verificarSesion(t, S, new Date(t0.getTime() + 12 * 3600_000 + 1000))).toBeNull();
  });

  it('payload alterado da null', async () => {
    const t = await firmarSesion({ usuarioId: 'u1', versionSesion: 1 }, S);
    const [h, p, f] = t.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.sub = 'otro';
    expect(await verificarSesion(`${h}.${b64(payload)}.${f}`, S)).toBeNull();
  });

  it('iss o aud incorrectos dan null', async () => {
    const base = () => new SignJWT({ sv: 1 }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').setExpirationTime('1h');
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
      sub: 'u1', sv: 1, iss: 'criterio-api', aud: 'criterio-web', exp: ahora + 3600,
    })}.`;
    expect(await verificarSesion(t, S)).toBeNull();
  });

  it('basura da null sin lanzar', async () => {
    expect(await verificarSesion('no-es-un-jwt', S)).toBeNull();
  });
});
