import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { COOKIE_SESION } from '../../src/auth/cookies';
import { limpiarBase, prismaPrueba } from '../db';
import { crearOrganizacion } from '../fabricas';
import { appAuth, valorCookie } from './auth-utilidades';
import { miembroCon } from './organizaciones-utilidades';

beforeEach(limpiarBase);

// Una sola app (un solo resolver con su caché de 60 s) para que las pruebas de invalidación tengan sentido.
const app = appAuth();
const ruta = (membresiaId: string) => `/api/organizacion/miembros/${membresiaId}`;
const cambiarRol = (cabeceras: Record<string, string>, membresiaId: string, rol: string) =>
  request(app).patch(ruta(membresiaId)).set(cabeceras).send({ rol });
const eliminar = (cabeceras: Record<string, string>, membresiaId: string) =>
  request(app).delete(ruta(membresiaId)).set(cabeceras);

describe('GET /api/organizacion/miembros', () => {
  it('lista los miembros de la empresa propia, sin los de otras ni secretos', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const reclutador = await miembroCon(org.id, 'RECLUTADOR');
    const otra = await crearOrganizacion();
    const ajeno = await miembroCon(otra.id, 'OWNER');

    const res = await request(app).get('/api/organizacion/miembros').set(reclutador.cabeceras);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body).toContainEqual({
      membresiaId: dueno.membresia.id,
      usuario: { id: dueno.usuario.id, nombre: dueno.usuario.nombre, email: dueno.usuario.email },
      rol: 'OWNER',
      creadoEn: dueno.membresia.creadoEn.toISOString(),
    });
    expect(res.text).not.toContain(ajeno.usuario.id);
    expect(res.text).not.toContain('passwordHash');
    expect(res.text).not.toContain('no-usar');
  });
});

describe('PATCH /api/organizacion/miembros/:membresiaId', () => {
  it('un ADMIN no puede degradar a un OWNER, ni asignar OWNER → 403', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const admin = await miembroCon(org.id, 'ADMIN');
    const reclutador = await miembroCon(org.id, 'RECLUTADOR');

    const degradar = await cambiarRol(admin.cabeceras, dueno.membresia.id, 'RECLUTADOR');
    expect(degradar.status).toBe(403);
    expect(degradar.body.error.code).toBe('FORBIDDEN');
    const ascender = await cambiarRol(admin.cabeceras, reclutador.membresia.id, 'OWNER');
    expect(ascender.status).toBe(403);
    expect(ascender.body.error.code).toBe('FORBIDDEN');

    const filas = await prismaPrueba.membresia.findMany({ where: { organizacionId: org.id }, orderBy: { rol: 'asc' } });
    expect(filas.map((m) => [m.rol, m.version])).toEqual([
      ['OWNER', 1],
      ['ADMIN', 1],
      ['RECLUTADOR', 1],
    ]);
  });

  it('un ADMIN sí cambia el rol de un RECLUTADOR; sube la versión y audita CAMBIO_ROL', async () => {
    const org = await crearOrganizacion();
    const admin = await miembroCon(org.id, 'ADMIN');
    const reclutador = await miembroCon(org.id, 'RECLUTADOR');

    const res = await cambiarRol(admin.cabeceras, reclutador.membresia.id, 'ENTREVISTADOR');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ membresiaId: reclutador.membresia.id, rol: 'ENTREVISTADOR' });
    const fila = await prismaPrueba.membresia.findUniqueOrThrow({ where: { id: reclutador.membresia.id } });
    expect(fila).toMatchObject({ rol: 'ENTREVISTADOR', version: 2 });
    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'CAMBIO_ROL' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ usuarioId: admin.usuario.id, organizacionAfectadaId: org.id });
    expect(eventos[0]?.datos).toMatchObject({ rolAnterior: 'RECLUTADOR', rolNuevo: 'ENTREVISTADOR' });
  });

  it('el último OWNER no puede degradarse → 409 HAS_DEPENDENCIES; con dos OWNER sí puede', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');

    const solo = await cambiarRol(dueno.cabeceras, dueno.membresia.id, 'ADMIN');
    expect(solo.status).toBe(409);
    expect(solo.body.error.code).toBe('HAS_DEPENDENCIES');
    expect(solo.body.error.message).toMatch(/OWNER/);

    await miembroCon(org.id, 'OWNER');
    const conOtro = await cambiarRol(dueno.cabeceras, dueno.membresia.id, 'ADMIN');
    expect(conOtro.status).toBe(200);
    expect((await prismaPrueba.membresia.findUniqueOrThrow({ where: { id: dueno.membresia.id } })).rol).toBe('ADMIN');
    // Su propia membresía cambió de versión: se le emite una sesión nueva con el rol nuevo.
    expect(valorCookie(conOtro, COOKIE_SESION)).toBeTruthy();
  });

  it('la sesión vieja de la persona deja de tener el rol anterior apenas cambia (sin esperar 60 s)', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const admin = await miembroCon(org.id, 'ADMIN');
    // Llena la caché del resolver con la membresía ADMIN vigente.
    expect((await request(app).put('/api/organizacion').set(admin.cabeceras).send({ nombre: 'Antes' })).status).toBe(200);

    expect((await cambiarRol(dueno.cabeceras, admin.membresia.id, 'RECLUTADOR')).status).toBe(200);

    // El token viejo ya no habilita la empresa (Membresia.version cambió): nada de permisos de ADMIN.
    const despues = await request(app).put('/api/organizacion').set(admin.cabeceras).send({ nombre: 'Después' });
    expect(despues.status).toBe(403);
    const yo = await request(app).get('/api/auth/yo').set(admin.cabeceras);
    expect(yo.body.empresaActiva).toBeNull();
    expect(yo.body.empresas).toEqual([expect.objectContaining({ organizacionId: org.id, rol: 'RECLUTADOR' })]);
    // Al volver a elegir la empresa, la sesión trae el rol nuevo.
    const elegir = await request(app).post('/api/auth/cambiar-empresa').set(admin.cabeceras).send({ organizacionId: org.id });
    expect(elegir.status).toBe(200);
    expect(elegir.body.empresaActiva.rol).toBe('RECLUTADOR');
  });

  it('una membresía de otra empresa → 404', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const ajeno = await miembroCon((await crearOrganizacion()).id, 'RECLUTADOR');
    const res = await cambiarRol(dueno.cabeceras, ajeno.membresia.id, 'ADMIN');
    expect(res.status).toBe(404);
    expect((await prismaPrueba.membresia.findUniqueOrThrow({ where: { id: ajeno.membresia.id } })).rol).toBe('RECLUTADOR');
  });
});

describe('DELETE /api/organizacion/miembros/:membresiaId', () => {
  it('204: la persona eliminada pierde la empresa en su sesión y se audita MIEMBRO_ELIMINADO', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const reclutador = await miembroCon(org.id, 'RECLUTADOR');
    expect((await request(app).get('/api/organizacion').set(reclutador.cabeceras)).status).toBe(200);

    // En mayúsculas a propósito: la caché se invalida con el id canónico, no con el texto de la URL.
    const res = await eliminar(dueno.cabeceras, reclutador.membresia.id.toUpperCase());

    expect(res.status).toBe(204);
    expect(await prismaPrueba.membresia.findUnique({ where: { id: reclutador.membresia.id } })).toBeNull();
    const despues = await request(app).get('/api/organizacion').set(reclutador.cabeceras);
    expect(despues.status).toBe(403);
    expect(despues.body.error.code).toBe('SIN_EMPRESA');
    const yo = await request(app).get('/api/auth/yo').set(reclutador.cabeceras);
    expect(yo.body).toMatchObject({ empresas: [], empresaActiva: null });
    const eventos = await prismaPrueba.eventoAuditoria.findMany({ where: { tipo: 'MIEMBRO_ELIMINADO' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ usuarioId: dueno.usuario.id, organizacionAfectadaId: org.id });
  });

  it('un ADMIN no puede eliminar a un OWNER → 403', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const admin = await miembroCon(org.id, 'ADMIN');
    const res = await eliminar(admin.cabeceras, dueno.membresia.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prismaPrueba.membresia.count({ where: { organizacionId: org.id } })).toBe(2);
  });

  it('el último OWNER no puede eliminarse → 409 HAS_DEPENDENCIES', async () => {
    const org = await crearOrganizacion();
    const dueno = await miembroCon(org.id, 'OWNER');
    const res = await eliminar(dueno.cabeceras, dueno.membresia.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_DEPENDENCIES');
    expect(await prismaPrueba.membresia.count()).toBe(1);
  });

  it('un RECLUTADOR no puede eliminar → 403', async () => {
    const org = await crearOrganizacion();
    const reclutador = await miembroCon(org.id, 'RECLUTADOR');
    const otro = await miembroCon(org.id, 'ENTREVISTADOR');
    const res = await eliminar(reclutador.cabeceras, otro.membresia.id);
    expect(res.status).toBe(403);
  });
});
