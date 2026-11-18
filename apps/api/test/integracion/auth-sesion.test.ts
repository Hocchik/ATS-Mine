import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { COOKIE_CSRF, COOKIE_SESION } from '../../src/auth/cookies';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion } from '../fabricas';
import { ORIGEN_PRUEBA } from '../sesion-real';
import { appAuth, CONTRASENA, csrfDe, lineaCookie, personaConContrasena, valorCookie } from './auth-utilidades';

beforeEach(limpiarBase);

/** Agente con sesión iniciada por el login real; devuelve también el CSRF vigente. */
async function conSesion(email: string) {
  const agente = request.agent(appAuth());
  const res = await agente.post('/api/auth/login').send({ email, contrasena: CONTRASENA });
  expect(res.status).toBe(200);
  return { agente, login: res, csrf: csrfDe(res) };
}

describe('GET /api/auth/yo', () => {
  it('sin sesión → 401 UNAUTHENTICATED', async () => {
    const res = await request(appAuth()).get('/api/auth/yo');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('lista las empresas de la persona (también las suspendidas) y nunca las ajenas', async () => {
    const persona = await personaConContrasena();
    const propia = await crearOrganizacion({ nombre: 'Propia' });
    const ajena = await crearOrganizacion({ nombre: 'Ajena' });
    await crearMembresia(persona.id, propia.id, 'RECLUTADOR');
    const otra = await personaConContrasena();
    await crearMembresia(otra.id, ajena.id, 'OWNER');

    const { agente } = await conSesion(persona.email);
    const yo = await agente.get('/api/auth/yo');
    expect(yo.status).toBe(200);
    expect(yo.body.empresas).toEqual([
      { organizacionId: propia.id, nombre: 'Propia', slug: propia.slug, rol: 'RECLUTADOR', estadoVerificacion: 'PENDIENTE' },
    ]);
    expect(yo.text).not.toContain(ajena.id);
    expect(yo.text).not.toContain('$2');
    expect(yo.text).not.toContain('versionSesion');
  });
});

describe('POST /api/auth/logout', () => {
  it('sin CSRF → 403; con CSRF → 204, limpia las cookies y /yo → 401', async () => {
    const persona = await personaConContrasena();
    const { agente, csrf } = await conSesion(persona.email);

    const sinCsrf = await agente.post('/api/auth/logout').set('Origin', ORIGEN_PRUEBA);
    expect(sinCsrf.status).toBe(403);
    expect(sinCsrf.body.error.code).toBe('CSRF_INVALIDO');
    expect((await agente.get('/api/auth/yo')).status).toBe(200);

    const res = await agente.post('/api/auth/logout').set('Origin', ORIGEN_PRUEBA).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(204);
    expect(lineaCookie(res, COOKIE_SESION)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(lineaCookie(res, COOKIE_CSRF)).toMatch(/Expires=Thu, 01 Jan 1970/);

    const yo = await agente.get('/api/auth/yo');
    expect(yo.status).toBe(401);
  });
});

describe('POST /api/auth/cambiar-empresa', () => {
  async function preparar() {
    const persona = await personaConContrasena();
    const primera = await crearOrganizacion({ nombre: 'Primera' });
    const segunda = await crearOrganizacion({ nombre: 'Segunda' });
    const m1 = await crearMembresia(persona.id, primera.id, 'OWNER');
    const m2 = await crearMembresia(persona.id, segunda.id, 'ENTREVISTADOR');
    // La primera es la más reciente: el login la elige como activa.
    await prismaPrueba.membresia.update({ where: { id: m2.id }, data: { creadoEn: new Date('2026-01-01T00:00:00Z') } });
    await prismaPrueba.membresia.update({ where: { id: m1.id }, data: { creadoEn: new Date('2026-06-01T00:00:00Z') } });
    const sesion = await conSesion(persona.email);
    expect(sesion.login.body.empresaActiva.organizacionId).toBe(primera.id);
    return { persona, primera, segunda, ...sesion };
  }

  const cambiar = (agente: ReturnType<typeof request.agent>, csrf: string, organizacionId: string) =>
    agente.post('/api/auth/cambiar-empresa').set('Origin', ORIGEN_PRUEBA).set('X-CSRF-Token', csrf).send({ organizacionId });

  it('a una empresa sin membresía → 404 NOT_FOUND y la sesión no cambia', async () => {
    const { agente, csrf, primera } = await preparar();
    const ajena = await crearOrganizacion();
    const res = await cambiar(agente, csrf, ajena.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(lineaCookie(res, COOKIE_SESION)).toBeUndefined();
    expect((await agente.get('/api/auth/yo')).body.empresaActiva.organizacionId).toBe(primera.id);
  });

  it('a una empresa propia pero suspendida → 404 NOT_FOUND', async () => {
    const { agente, csrf, segunda } = await preparar();
    await prismaPrueba.organizacion.update({ where: { id: segunda.id }, data: { estadoVerificacion: 'SUSPENDIDA' } });
    const res = await cambiar(agente, csrf, segunda.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('sin CSRF → 403 CSRF_INVALIDO', async () => {
    const { agente, segunda } = await preparar();
    const res = await agente.post('/api/auth/cambiar-empresa').set('Origin', ORIGEN_PRUEBA).send({ organizacionId: segunda.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALIDO');
  });

  it('a una propia → 200, rota el CSRF y /yo muestra la nueva empresa activa', async () => {
    const { agente, csrf, segunda } = await preparar();
    const res = await cambiar(agente, csrf, segunda.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      empresaActiva: { organizacionId: segunda.id, nombre: 'Segunda', slug: segunda.slug, rol: 'ENTREVISTADOR' },
    });
    const nuevoCsrf = valorCookie(res, COOKIE_CSRF);
    expect(nuevoCsrf).toBeTruthy();
    expect(nuevoCsrf).not.toBe(csrf);
    expect(res.text).not.toContain(valorCookie(res, COOKIE_SESION) ?? 'sin-cookie');

    const yo = await agente.get('/api/auth/yo');
    expect(yo.body.empresaActiva).toEqual(res.body.empresaActiva);

    // El CSRF anterior ya no sirve.
    const viejo = await agente.post('/api/auth/logout').set('Origin', ORIGEN_PRUEBA).set('X-CSRF-Token', csrf);
    expect(viejo.status).toBe(403);
  });

  it('organizacionId que no es UUID → 400 VALIDATION_FAILED', async () => {
    const { agente, csrf } = await preparar();
    const res = await cambiar(agente, csrf, 'no-es-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
