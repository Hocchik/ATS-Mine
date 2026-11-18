import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';
import { cabecerasDeSesionReal, ORIGEN_PRUEBA } from '../sesion-real';
import { appAuth, csrfDe } from './auth-utilidades';
import { aceptarCon, agenteRegistrado, invitacionConToken, invitar, tokenDelEnlace } from './invitaciones-utilidades';
import { miembroCon } from './organizaciones-utilidades';

beforeEach(limpiarBase);

const app = appAuth();
const TOKEN_INVENTADO = 'A'.repeat(43);

const esTokenInvalido = (res: request.Response) => {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('TOKEN_INVALIDO');
  return res.body.error.message as string;
};

describe('GET /public/invitaciones/:token', () => {
  it('una invitación válida → nombre de la empresa, email y rol; nunca el hash', async () => {
    const org = await crearOrganizacion({ nombre: 'Acme Ficticia' });
    const { token } = await invitacionConToken(org.id, { email: 'ana@ejemplo.test', rol: 'ADMIN' });

    const res = await request(app).get(`/public/invitaciones/${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ organizacion: { nombre: 'Acme Ficticia' }, email: 'ana@ejemplo.test', rol: 'ADMIN' });
    expect(res.text).not.toContain('tokenHash');
  });

  it('un token inventado, mal formado, vencido, revocado o de empresa suspendida → 400 con el mismo mensaje', async () => {
    const org = await crearOrganizacion();
    const vencida = await invitacionConToken(org.id, { email: 'v@ejemplo.test' });
    await prismaPrueba.invitacion.update({ where: { id: vencida.invitacion.id }, data: { expiraEn: new Date(Date.now() - 1000) } });
    const revocada = await invitacionConToken(org.id, { email: 'r@ejemplo.test' });
    await prismaPrueba.invitacion.update({ where: { id: revocada.invitacion.id }, data: { revocadaEn: new Date() } });
    const suspendida = await crearOrganizacion();
    await prismaPrueba.organizacion.update({ where: { id: suspendida.id }, data: { estadoVerificacion: 'SUSPENDIDA' } });
    const deSuspendida = await invitacionConToken(suspendida.id, { email: 's@ejemplo.test' });

    const mensajes = [];
    for (const token of [TOKEN_INVENTADO, 'corto', vencida.token, revocada.token, deSuspendida.token]) {
      const res = await request(app).get(`/public/invitaciones/${token}`);
      mensajes.push(esTokenInvalido(res));
      expect(res.text).not.toContain('tokenHash');
    }
    expect(new Set(mensajes).size).toBe(1);
  });
});

describe('POST /api/invitaciones/:token/aceptar', () => {
  it('ciclo completo: el OWNER invita, la persona se registra con ese email, acepta y /yo muestra la empresa', async () => {
    const org = await crearOrganizacion({ nombre: 'Empresa Invitante' });
    const dueno = await miembroCon(org.id, 'OWNER');
    const creada = await invitar(app, dueno.cabeceras, { email: 'invitada@ejemplo.test', rol: 'RECLUTADOR' });
    expect(creada.status).toBe(201);
    const token = tokenDelEnlace(creada.body.enlace);

    const { agente, csrf } = await agenteRegistrado(app, 'Invitada@Ejemplo.test');
    const res = await aceptarCon(agente, csrf, token);

    expect(res.status).toBe(200);
    expect(res.body.empresaActiva).toEqual({
      organizacionId: org.id,
      nombre: 'Empresa Invitante',
      slug: org.slug,
      rol: 'RECLUTADOR',
    });
    expect(csrfDe(res)).not.toBe(csrf);

    const yo = await agente.get('/api/auth/yo');
    expect(yo.status).toBe(200);
    expect(yo.body.empresaActiva).toMatchObject({ organizacionId: org.id, rol: 'RECLUTADOR' });
    expect(yo.body.empresas).toHaveLength(1);

    const fila = await prismaPrueba.invitacion.findUniqueOrThrow({ where: { id: creada.body.id } });
    expect(fila.aceptadaEn).toBeInstanceOf(Date);
    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'INVITACION_ACEPTADA' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ organizacionAfectadaId: org.id, usuarioId: yo.body.usuario.id });
    expect(eventos[0]?.datos).toMatchObject({ invitacionId: fila.id, rolInvitado: 'RECLUTADOR' });

    // La invitación aceptada ya no se puede consultar.
    esTokenInvalido(await request(app).get(`/public/invitaciones/${token}`));
  });

  it('con una cuenta de otro email → 400 y no crea membresía', async () => {
    const org = await crearOrganizacion();
    const { token } = await invitacionConToken(org.id, { email: 'invitada@ejemplo.test' });
    const { agente, csrf } = await agenteRegistrado(app, 'otra@ejemplo.test');

    esTokenInvalido(await aceptarCon(agente, csrf, token));
    expect(await prismaPrueba.membresia.count({ where: { organizacionId: org.id } })).toBe(0);
    const fila = await prismaPrueba.invitacion.findFirstOrThrow({ where: { organizacionId: org.id } });
    expect(fila.aceptadaEn).toBeNull();
  });

  it('aceptar dos veces → la segunda, 400', async () => {
    const org = await crearOrganizacion();
    const { token } = await invitacionConToken(org.id, { email: 'dos@ejemplo.test' });
    const { agente, csrf } = await agenteRegistrado(app, 'dos@ejemplo.test');

    const primera = await aceptarCon(agente, csrf, token);
    expect(primera.status).toBe(200);
    esTokenInvalido(await aceptarCon(agente, csrfDe(primera), token));
    expect(await prismaPrueba.membresia.count({ where: { organizacionId: org.id } })).toBe(1);
  });

  it('una invitación vencida → 400', async () => {
    const org = await crearOrganizacion();
    const { invitacion, token } = await invitacionConToken(org.id, { email: 'tarde@ejemplo.test' });
    await prismaPrueba.invitacion.update({ where: { id: invitacion.id }, data: { expiraEn: new Date(Date.now() - 1000) } });
    const { agente, csrf } = await agenteRegistrado(app, 'tarde@ejemplo.test');

    esTokenInvalido(await aceptarCon(agente, csrf, token));
    expect(await prismaPrueba.membresia.count({ where: { organizacionId: org.id } })).toBe(0);
  });

  it('una invitación revocada → 400', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const { invitacion, token } = await invitacionConToken(org.id, { email: 'revocada@ejemplo.test' });
    const revocar = await request(app).delete(`/api/organizacion/invitaciones/${invitacion.id}`).set(dueno.cabeceras);
    expect(revocar.status).toBe(204);
    const { agente, csrf } = await agenteRegistrado(app, 'revocada@ejemplo.test');

    esTokenInvalido(await aceptarCon(agente, csrf, token));
    expect(await prismaPrueba.membresia.count({ where: { organizacionId: org.id } })).toBe(1);
  });

  it('un token inventado o mal formado → 400', async () => {
    const { agente, csrf } = await agenteRegistrado(app, 'nadie@ejemplo.test');
    esTokenInvalido(await aceptarCon(agente, csrf, TOKEN_INVENTADO));
    esTokenInvalido(await aceptarCon(agente, csrf, 'corto'));
  });

  it('quien ya es miembro de esa empresa → 409', async () => {
    const org = await crearOrganizacion();
    const persona = await crearUsuario();
    await crearMembresia(persona.id, org.id, 'RECLUTADOR');
    const { invitacion, token } = await invitacionConToken(org.id, { email: persona.email, rol: 'ADMIN' });
    const cabeceras = await cabecerasDeSesionReal({ usuarioId: persona.id });

    const res = await request(app).post(`/api/invitaciones/${token}/aceptar`).set(cabeceras);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
    const fila = await prismaPrueba.invitacion.findUniqueOrThrow({ where: { id: invitacion.id } });
    expect(fila.aceptadaEn).toBeNull();
  });

  it('sin sesión → 401; sin CSRF → 403', async () => {
    const org = await crearOrganizacion();
    const { token } = await invitacionConToken(org.id, { email: 'csrf@ejemplo.test' });
    const sinSesion = await request(app).post(`/api/invitaciones/${token}/aceptar`).set('Origin', ORIGEN_PRUEBA);
    expect(sinSesion.status).toBe(401);
    const { agente } = await agenteRegistrado(app, 'csrf@ejemplo.test');
    const sinCsrf = await agente.post(`/api/invitaciones/${token}/aceptar`).set('Origin', ORIGEN_PRUEBA);
    expect(sinCsrf.status).toBe(403);
  });
});
