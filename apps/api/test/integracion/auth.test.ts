import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { COOKIE_CSRF, COOKIE_SESION } from '../../src/auth/cookies';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion } from '../fabricas';
import { SEGURIDAD_PRUEBA } from '../sesion-real';
import { appAuth, CONTRASENA, lineaCookie, personaConContrasena, valorCookie } from './auth-utilidades';

beforeEach(limpiarBase);

const datosRegistro = (email = 'ana@ejemplo.test') => ({ nombre: 'Ana Prueba', email, contrasena: CONTRASENA });

describe('POST /api/auth/registro', () => {
  it('201 con cookies de sesión (httpOnly, SameSite=Lax) y CSRF; después /yo sin empresas', async () => {
    const agente = request.agent(appAuth());
    const res = await agente.post('/api/auth/registro').send(datosRegistro('Ana@Ejemplo.test'));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ usuario: { id: expect.any(String), nombre: 'Ana Prueba', email: 'ana@ejemplo.test' } });
    const sesion = lineaCookie(res, COOKIE_SESION) ?? '';
    expect(sesion).toMatch(/HttpOnly/i);
    expect(sesion).toMatch(/SameSite=Lax/i);
    const csrf = lineaCookie(res, COOKIE_CSRF) ?? '';
    expect(csrf).not.toBe('');
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(res.text).not.toContain(valorCookie(res, COOKIE_SESION) ?? 'sin-cookie');
    expect(res.text).not.toContain('$2');

    const yo = await agente.get('/api/auth/yo');
    expect(yo.status).toBe(200);
    expect(yo.body).toEqual({
      usuario: { id: res.body.usuario.id, nombre: 'Ana Prueba', email: 'ana@ejemplo.test', esSuperadmin: false },
      empresas: [],
      empresaActiva: null,
    });

    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'REGISTRO' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.usuarioId).toBe(res.body.usuario.id);
    expect(JSON.stringify(eventos[0]?.datos)).not.toContain('ana@');
  });

  it('email existente (sin importar mayúsculas) → 409 DUPLICATE con mensaje genérico y sin cookies', async () => {
    const app = appAuth();
    expect((await request(app).post('/api/auth/registro').send(datosRegistro())).status).toBe(201);
    const res = await request(app).post('/api/auth/registro').send(datosRegistro('ANA@ejemplo.test'));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
    expect(res.body.error.message).toBe('No se pudo crear la cuenta con esos datos');
    expect(lineaCookie(res, COOKIE_SESION)).toBeUndefined();
  });

  it('body inválido → 400 VALIDATION_FAILED', async () => {
    const res = await request(appAuth()).post('/api/auth/registro').send({ nombre: 'X', email: 'no', contrasena: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/auth/login', () => {
  it('correcto → 200 con cookies, sin passwordHash, versión de sesión ni token en el cuerpo; audita LOGIN', async () => {
    const persona = await personaConContrasena();
    const res = await request(appAuth()).post('/api/auth/login').send({ email: persona.email, contrasena: CONTRASENA });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      usuario: { id: persona.id, nombre: persona.nombre, email: persona.email, esSuperadmin: false },
      empresaActiva: null,
    });
    expect(lineaCookie(res, COOKIE_SESION)).toMatch(/HttpOnly/i);
    expect(valorCookie(res, COOKIE_CSRF)).toBeTruthy();
    expect(res.text).not.toContain('$2');
    expect(res.text).not.toContain('passwordHash');
    expect(res.text).not.toContain('versionSesion');
    expect(res.text).not.toContain(valorCookie(res, COOKIE_SESION) ?? 'sin-cookie');

    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'LOGIN' } });
    expect(eventos.map((e) => e.usuarioId)).toEqual([persona.id]);
  });

  it('contraseña incorrecta y email inexistente → 401 con el mismo cuerpo salvo requestId', async () => {
    const persona = await personaConContrasena();
    const app = appAuth();
    const mala = await request(app).post('/api/auth/login').send({ email: persona.email, contrasena: 'otra-contrasena-mala' });
    const nadie = await request(app).post('/api/auth/login').send({ email: 'nadie@ejemplo.test', contrasena: CONTRASENA });

    for (const res of [mala, nadie]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CREDENCIALES_INVALIDAS');
      expect(lineaCookie(res, COOKIE_SESION)).toBeUndefined();
    }
    const sinId = (cuerpo: { error: Record<string, unknown> }) => ({ error: { ...cuerpo.error, requestId: 'x' } });
    expect(sinId(mala.body)).toEqual(sinId(nadie.body));
    expect(mala.body.error.requestId).not.toBe(nadie.body.error.requestId);
  });

  it('login fallido audita LOGIN_FALLIDO con usuarioId solo si existe, con IP y sin el email en datos', async () => {
    const persona = await personaConContrasena();
    const app = appAuth();
    await request(app).post('/api/auth/login').send({ email: persona.email, contrasena: 'otra-contrasena-mala' });
    await request(app).post('/api/auth/login').send({ email: 'nadie@ejemplo.test', contrasena: CONTRASENA });

    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'LOGIN_FALLIDO' }, orderBy: { creadoEn: 'asc' } });
    expect(eventos.map((e) => e.usuarioId)).toEqual([persona.id, null]);
    for (const evento of eventos) {
      expect(evento.ip).toBeTruthy();
      const datos = JSON.stringify(evento.datos);
      expect(datos).not.toContain(persona.email);
      expect(datos).not.toContain('nadie@');
      expect(datos).not.toMatch(/mail/i);
    }
  });

  it('con 2 membresías y la más reciente en una empresa suspendida, la activa es la no suspendida', async () => {
    const persona = await personaConContrasena();
    const activa = await crearOrganizacion({ nombre: 'Activa' });
    const suspendida = await crearOrganizacion({ nombre: 'Suspendida' });
    await prismaPrueba.organizacion.update({ where: { id: suspendida.id }, data: { estadoVerificacion: 'SUSPENDIDA' } });
    const vieja = await crearMembresia(persona.id, activa.id, 'ADMIN');
    const nueva = await crearMembresia(persona.id, suspendida.id, 'OWNER');
    await prismaPrueba.membresia.update({ where: { id: vieja.id }, data: { creadoEn: new Date('2026-01-01T00:00:00Z') } });
    await prismaPrueba.membresia.update({ where: { id: nueva.id }, data: { creadoEn: new Date('2026-06-01T00:00:00Z') } });

    const agente = request.agent(appAuth());
    const res = await agente.post('/api/auth/login').send({ email: persona.email, contrasena: CONTRASENA });
    expect(res.status).toBe(200);
    expect(res.body.empresaActiva).toEqual({ organizacionId: activa.id, nombre: 'Activa', slug: activa.slug, rol: 'ADMIN' });

    const yo = await agente.get('/api/auth/yo');
    expect(yo.body.empresaActiva).toEqual(res.body.empresaActiva);
    expect(yo.body.empresas).toHaveLength(2);
    const evento = await prismaPrueba.eventoAuditoria.findFirst({ where: { tipo: 'LOGIN' } });
    expect(evento?.organizacionAfectadaId).toBe(activa.id);
  });

  it('el limitador por email bloquea el intento 11 aunque cambie la IP (edge simulado); otro email sigue pasando', async () => {
    const edge = 'e'.repeat(40);
    const app = appAuth({ ...SEGURIDAD_PRUEBA, edgeSecret: edge });
    const persona = await personaConContrasena();
    const intento = (n: number, email = persona.email) =>
      request(app)
        .post('/api/auth/login')
        .set('x-criterio-edge', edge)
        .set('x-vercel-forwarded-for', `203.0.113.${n}`)
        .send({ email, contrasena: 'otra-contrasena-mala' });

    for (let n = 1; n <= 10; n++) expect((await intento(n)).status).toBe(401);
    const bloqueado = await intento(11);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error.code).toBe('RATE_LIMITED');
    // Mismo email con otras mayúsculas: la clave es el email normalizado.
    expect((await intento(12, persona.email.toUpperCase())).status).toBe(429);
    expect((await intento(13, 'otra@ejemplo.test')).status).toBe(401);
  });
});
