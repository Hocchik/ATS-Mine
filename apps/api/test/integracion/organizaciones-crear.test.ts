import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { COOKIE_SESION } from '../../src/auth/cookies';
import { limpiarBase, prismaPrueba } from '../db';
import { crearOrganizacion } from '../fabricas';
import { ORIGEN_PRUEBA } from '../sesion-real';
import { appAuth, CONTRASENA, csrfDe, personaConContrasena, valorCookie } from './auth-utilidades';

beforeEach(limpiarBase);

const datosEmpresa = (slug = 'acme-demo') => ({
  nombre: 'Acme Demo',
  slug,
  zonaHoraria: 'America/Lima',
  locale: 'es-PE',
  pais: 'pe',
});

/** Persona con sesión iniciada por el login real (sin empresa todavía). */
async function conSesion() {
  const persona = await personaConContrasena();
  const agente = request.agent(appAuth());
  const login = await agente.post('/api/auth/login').send({ email: persona.email, contrasena: CONTRASENA });
  expect(login.status).toBe(200);
  expect(login.body.empresaActiva).toBeNull();
  const crear = (cuerpo: object) =>
    agente.post('/api/organizaciones').set('Origin', ORIGEN_PRUEBA).set('X-CSRF-Token', csrfDe(login)).send(cuerpo);
  return { persona, agente, crear };
}

describe('POST /api/organizaciones', () => {
  it('201 en estado PENDIENTE con la persona como OWNER; /yo la muestra como activa', async () => {
    const { persona, agente, crear } = await conSesion();

    const res = await crear(datosEmpresa());

    expect(res.status).toBe(201);
    expect(res.body.organizacion).toMatchObject({
      nombre: 'Acme Demo',
      slug: 'acme-demo',
      estadoVerificacion: 'PENDIENTE',
      zonaHoraria: 'America/Lima',
      locale: 'es-PE',
      pais: 'PE',
      esDemo: false,
    });
    const organizacionId = res.body.organizacion.id as string;
    expect(res.body.empresaActiva).toEqual({ organizacionId, nombre: 'Acme Demo', slug: 'acme-demo', rol: 'OWNER' });
    // La sesión se vuelve a emitir con la empresa nueva (cookie httpOnly; el token nunca va en el cuerpo).
    const token = valorCookie(res, COOKIE_SESION);
    expect(token).toBeTruthy();
    expect(res.text).not.toContain(token ?? 'sin-token');

    const membresias = await prismaPrueba.membresia.findMany({ where: { organizacionId } });
    expect(membresias).toEqual([expect.objectContaining({ usuarioId: persona.id, rol: 'OWNER' })]);

    const yo = await agente.get('/api/auth/yo');
    expect(yo.status).toBe(200);
    expect(yo.body.empresaActiva).toEqual({ organizacionId, nombre: 'Acme Demo', slug: 'acme-demo', rol: 'OWNER' });

    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'ORGANIZACION_CREADA' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ usuarioId: persona.id, organizacionAfectadaId: organizacionId });
  });

  it('un slug reservado → 400 VALIDATION_FAILED y no crea nada', async () => {
    const { crear } = await conSesion();
    const res = await crear(datosEmpresa('admin'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await prismaPrueba.organizacion.count()).toBe(0);
  });

  it('un slug en uso → 409 DUPLICATE', async () => {
    const existente = await crearOrganizacion();
    const { crear } = await conSesion();
    const res = await crear(datosEmpresa(existente.slug));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
    expect(await prismaPrueba.organizacion.count()).toBe(1);
  });

  it('un slug que figura como anterior de otra empresa → 409 DUPLICATE', async () => {
    const otra = await crearOrganizacion();
    await prismaPrueba.slugAnterior.create({ data: { slug: 'nombre-viejo', organizacionIdDestino: otra.id } });
    const { crear } = await conSesion();
    const res = await crear(datosEmpresa('nombre-viejo'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
    expect(await prismaPrueba.membresia.count()).toBe(0);
  });

  it('sin sesión → 401', async () => {
    const res = await request(appAuth()).post('/api/organizaciones').set('Origin', ORIGEN_PRUEBA).send(datosEmpresa());
    expect(res.status).toBe(401);
  });
});
