import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { COOKIE_CSRF, COOKIE_SESION, emitirSesion, limpiarSesion } from '../../src/auth/cookies';

function app(segura: boolean) {
  const a = express();
  // Rutas de prueba fuera de src: no pasan por el registro.
  a.get('/emitir', (_req, res) => {
    res.json(emitirSesion(res, { token: 'tok', segura }));
  });
  a.get('/limpiar', (_req, res) => {
    limpiarSesion(res, { segura });
    res.end();
  });
  return a;
}

const cookies = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const buscar = (lista: string[], nombre: string) => lista.find((c) => c.startsWith(`${nombre}=`)) ?? '';

describe('cookies de sesión', () => {
  it('emite la sesión httpOnly y el CSRF legible, SameSite=Lax, Path=/, 12 h', async () => {
    const res = await request(app(false)).get('/emitir').expect(200);
    const lista = cookies(res);
    const sesion = buscar(lista, COOKIE_SESION);
    const csrf = buscar(lista, COOKIE_CSRF);
    expect(sesion).toMatch(/^criterio_sesion=tok;/);
    expect(sesion).toMatch(/HttpOnly/);
    expect(csrf).not.toMatch(/HttpOnly/);
    for (const c of [sesion, csrf]) {
      expect(c).toMatch(/SameSite=Lax/);
      expect(c).toMatch(/Path=\//);
      expect(c).toMatch(/Max-Age=43200/);
      expect(c).not.toMatch(/Secure/);
    }
    expect(res.body.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrf).toContain(`${COOKIE_CSRF}=${res.body.csrf};`);
  });

  it('marca Secure cuando se pide y genera un CSRF distinto cada vez', async () => {
    const a = await request(app(true)).get('/emitir');
    const b = await request(app(true)).get('/emitir');
    for (const c of cookies(a)) expect(c).toMatch(/Secure/);
    expect(a.body.csrf).not.toBe(b.body.csrf);
  });

  it('limpiarSesion expira ambas cookies', async () => {
    const lista = cookies(await request(app(true)).get('/limpiar'));
    for (const nombre of [COOKIE_SESION, COOKIE_CSRF]) {
      const c = buscar(lista, nombre);
      expect(c).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(c).toMatch(/Path=\//);
      expect(c).toMatch(/Secure/);
    }
  });
});
