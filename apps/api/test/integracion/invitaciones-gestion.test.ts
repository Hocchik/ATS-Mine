import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/auth/tokens-aleatorios';
import { limpiarBase, prismaPrueba } from '../db';
import { crearInvitacion, crearOrganizacion } from '../fabricas';
import { ORIGEN_PRUEBA } from '../sesion-real';
import { appAuth } from './auth-utilidades';
import { invitar, tokenDelEnlace } from './invitaciones-utilidades';
import { miembroCon } from './organizaciones-utilidades';

beforeEach(limpiarBase);

const app = appAuth();
const RUTA = '/api/organizacion/invitaciones';
const SIETE_DIAS_MS = 7 * 24 * 3600 * 1000;

describe('POST /api/organizacion/invitaciones', () => {
  it('un OWNER invita: 201 con el enlace (token solo aquí), guarda el hash, vence en 7 días y audita', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');

    const antes = Date.now();
    const res = await invitar(app, dueno.cabeceras, { email: 'Nueva@Ejemplo.test', rol: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'nueva@ejemplo.test', rol: 'ADMIN' });
    expect(res.body.enlace).toMatch(new RegExp(`^${ORIGEN_PRUEBA}/invitacion/[A-Za-z0-9_-]{43}$`));
    expect(res.text).not.toContain('tokenHash');
    const token = tokenDelEnlace(res.body.enlace);

    const fila = await prismaPrueba.invitacion.findUniqueOrThrow({
      where: { id: res.body.id },
      omit: { tokenHash: false },
    });
    expect(fila).toMatchObject({ organizacionId: org.id, creadaPorId: dueno.usuario.id, aceptadaEn: null });
    expect(fila.tokenHash).toBe(hashToken(token));
    expect(fila.tokenHash).not.toBe(token);
    expect(fila.expiraEn.getTime() - antes).toBeGreaterThanOrEqual(SIETE_DIAS_MS - 1000);
    expect(fila.expiraEn.getTime() - Date.now()).toBeLessThanOrEqual(SIETE_DIAS_MS);
    expect(new Date(res.body.expiraEn).getTime()).toBe(fila.expiraEn.getTime());

    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'INVITACION_CREADA' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ usuarioId: dueno.usuario.id, organizacionAfectadaId: org.id });
    expect(eventos[0]?.datos).toMatchObject({ invitacionId: fila.id, rolInvitado: 'ADMIN' });
    expect(JSON.stringify(eventos[0])).not.toContain('nueva@ejemplo.test');
  });

  it('un ADMIN que invita a un OWNER → 403; a un RECLUTADOR → 201', async () => {
    const org = await crearOrganizacion();
    const admin = await miembroCon(org.id, 'ADMIN');

    const owner = await invitar(app, admin.cabeceras, { email: 'jefa@ejemplo.test', rol: 'OWNER' });
    expect(owner.status).toBe(403);
    expect(owner.body.error.code).toBe('FORBIDDEN');
    const reclutador = await invitar(app, admin.cabeceras, { email: 'rec@ejemplo.test', rol: 'RECLUTADOR' });
    expect(reclutador.status).toBe(201);
    expect(await prismaPrueba.invitacion.count()).toBe(1);
  });

  it('un RECLUTADOR no puede invitar → 403', async () => {
    const org = await crearOrganizacion();
    const reclutador = await miembroCon(org.id, 'RECLUTADOR');
    const res = await invitar(app, reclutador.cabeceras, { email: 'x@ejemplo.test', rol: 'ENTREVISTADOR' });
    expect(res.status).toBe(403);
    expect(await prismaPrueba.invitacion.count()).toBe(0);
  });

  it('invitar a alguien que ya es miembro → 409 (el email se compara normalizado)', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const miembro = await miembroCon(org.id, 'RECLUTADOR');

    const res = await invitar(app, dueno.cabeceras, { email: miembro.usuario.email.toUpperCase(), rol: 'ADMIN' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
    expect(await prismaPrueba.invitacion.count()).toBe(0);
  });

  it('se puede invitar a quien es miembro de OTRA empresa', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const ajeno = await miembroCon((await crearOrganizacion()).id, 'OWNER');
    const res = await invitar(app, dueno.cabeceras, { email: ajeno.usuario.email, rol: 'RECLUTADOR' });
    expect(res.status).toBe(201);
  });

  it('un rol inválido → 400', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const res = await invitar(app, dueno.cabeceras, { email: 'x@ejemplo.test', rol: 'ROOT' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/organizacion/invitaciones', () => {
  it('lista solo las pendientes de la empresa propia, sin token ni hash', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const pendiente = await crearInvitacion(org.id, { email: 'pendiente@ejemplo.test', rol: 'ADMIN' });
    const aceptada = await crearInvitacion(org.id);
    await prismaPrueba.invitacion.update({ where: { id: aceptada.id }, data: { aceptadaEn: new Date() } });
    const revocada = await crearInvitacion(org.id);
    await prismaPrueba.invitacion.update({ where: { id: revocada.id }, data: { revocadaEn: new Date() } });
    const vencida = await crearInvitacion(org.id);
    await prismaPrueba.invitacion.update({ where: { id: vencida.id }, data: { expiraEn: new Date(Date.now() - 1000) } });
    const ajena = await crearInvitacion((await crearOrganizacion()).id);

    const res = await request(app).get(RUTA).set(dueno.cabeceras);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: pendiente.id,
        email: 'pendiente@ejemplo.test',
        rol: 'ADMIN',
        expiraEn: pendiente.expiraEn.toISOString(),
        creadoEn: pendiente.creadoEn.toISOString(),
      },
    ]);
    expect(res.text).not.toContain(ajena.id);
    expect(res.text).not.toContain('tokenHash');
    expect(res.text).not.toContain('token');
  });

  it('la empresa B no lista las invitaciones de A', async () => {
    const a = await crearOrganizacion();
    const deA = await crearInvitacion(a.id);
    const duenoB = await miembroCon((await crearOrganizacion()).id, 'OWNER');
    const res = await request(app).get(RUTA).set(duenoB.cabeceras);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.text).not.toContain(deA.id);
  });
});

describe('DELETE /api/organizacion/invitaciones/:id', () => {
  it('revoca: 204, marca revocadaEn y audita INVITACION_REVOCADA', async () => {
    const org = await crearOrganizacion();
    const admin = await miembroCon(org.id, 'ADMIN');
    const invitacion = await crearInvitacion(org.id);

    const res = await request(app).delete(`${RUTA}/${invitacion.id}`).set(admin.cabeceras);

    expect(res.status).toBe(204);
    const fila = await prismaPrueba.invitacion.findUniqueOrThrow({ where: { id: invitacion.id } });
    expect(fila.revocadaEn).toBeInstanceOf(Date);
    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'INVITACION_REVOCADA' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ usuarioId: admin.usuario.id, organizacionAfectadaId: org.id });
    expect(eventos[0]?.datos).toMatchObject({ invitacionId: invitacion.id });
  });

  it('la empresa B no revoca invitaciones de A → 404 y la fila queda igual', async () => {
    const a = await crearOrganizacion();
    const deA = await crearInvitacion(a.id);
    const duenoB = await miembroCon((await crearOrganizacion()).id, 'OWNER');

    const res = await request(app).delete(`${RUTA}/${deA.id}`).set(duenoB.cabeceras);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const fila = await prismaPrueba.invitacion.findUniqueOrThrow({ where: { id: deA.id } });
    expect(fila.revocadaEn).toBeNull();
  });

  it('un id inexistente o mal formado → 404', async () => {
    const dueno = await miembroCon((await crearOrganizacion()).id, 'OWNER');
    expect((await request(app).delete(`${RUTA}/${randomUUID()}`).set(dueno.cabeceras)).status).toBe(404);
    expect((await request(app).delete(`${RUTA}/no-es-uuid`).set(dueno.cabeceras)).status).toBe(404);
  });

  it('una invitación ya aceptada no se revoca → 409', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const invitacion = await crearInvitacion(org.id);
    await prismaPrueba.invitacion.update({ where: { id: invitacion.id }, data: { aceptadaEn: new Date() } });

    const res = await request(app).delete(`${RUTA}/${invitacion.id}`).set(dueno.cabeceras);

    expect(res.status).toBe(409);
    const fila = await prismaPrueba.invitacion.findUniqueOrThrow({ where: { id: invitacion.id } });
    expect(fila.revocadaEn).toBeNull();
  });
});
