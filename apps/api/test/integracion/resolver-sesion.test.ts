import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { crearResolverSesion } from '../../src/auth/resolver-sesion';
import { COOKIE_SESION } from '../../src/auth/cookies';
import { obtenerSesionEmpresa } from '../../src/http/sesion';
import { crearLogger } from '../../src/logger';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';
import { contenidoConEmpresa, cookieDeSesion, SECRETO_PRUEBA, SEGURIDAD_PRUEBA } from '../sesion-real';

const prisma = extenderConTenant(prismaPrueba);

function preparar(reloj?: () => number) {
  const resolverSesion = crearResolverSesion({ prisma, secreto: SECRETO_PRUEBA, reloj });
  const { app } = crearApp({
    logger: crearLogger('silent'),
    resolverSesion: resolverSesion.resolver,
    seguridad: SEGURIDAD_PRUEBA,
    modulos: [
      ({ registro, router }) =>
        registro.definir(router, { metodo: 'get', ruta: '/prueba/sesion', acceso: 'PUBLICA' }, async (req, res) => {
          res.json({ sesion: await resolverSesion.resolver(req) });
        }),
      ({ registro, router }) =>
        registro.definir(
          router,
          {
            metodo: 'get',
            ruta: '/api/prueba/tenant',
            acceso: 'TENANT',
            aislamiento: { preparar: async () => ({ tipo: 'COLECCION', ruta: '/api/prueba/tenant', marcador: 'no-aplica' }) },
          },
          (_req, res) => {
            res.json(obtenerSesionEmpresa(res));
          },
        ),
    ],
  });
  const sesion = async (cookie?: string) => {
    const peticion = request(app).get('/prueba/sesion');
    if (cookie) peticion.set('Cookie', cookie);
    const res = await peticion.expect(200);
    return res.body.sesion as unknown;
  };
  return { ...resolverSesion, sesion, app };
}

async function escenario() {
  const org = await crearOrganizacion();
  const usuario = await crearUsuario();
  const membresia = await crearMembresia(usuario.id, org.id, 'RECLUTADOR');
  return { org, usuario, membresia };
}

beforeEach(limpiarBase);

describe('crearResolverSesion', () => {
  it('cookie válida con empresa → SesionEmpresa con el rol de la membresía', async () => {
    const { org, usuario, membresia } = await escenario();
    const { sesion } = preparar();
    expect(await sesion(await cookieDeSesion(contenidoConEmpresa(usuario, membresia)))).toEqual({
      usuarioId: usuario.id,
      esSuperadmin: false,
      organizacionId: org.id,
      membresiaId: membresia.id,
      rol: 'RECLUTADOR',
    });
  });

  it('cookie válida sin empresa → SesionUsuario', async () => {
    const { usuario } = await escenario();
    await prismaPrueba.usuario.update({ where: { id: usuario.id }, data: { esSuperadmin: true } });
    const { sesion } = preparar();
    const cookie = await cookieDeSesion({ usuarioId: usuario.id, versionSesion: usuario.versionSesion });
    expect(await sesion(cookie)).toEqual({ usuarioId: usuario.id, esSuperadmin: true });
  });

  it('sin cookie, cookie basura o firmada con otro secreto → null', async () => {
    const { usuario } = await escenario();
    const { sesion } = preparar();
    expect(await sesion()).toBeNull();
    expect(await sesion(`${COOKIE_SESION}=basura.basura.basura`)).toBeNull();
    const otra = await cookieDeSesion(
      { usuarioId: usuario.id, versionSesion: 1 },
      { secreto: 'otro-secreto-de-longitud-suficiente-987654321' },
    );
    expect(await sesion(otra)).toBeNull();
  });

  it('persona inexistente → null', async () => {
    const { sesion } = preparar();
    const cookie = await cookieDeSesion({ usuarioId: '00000000-0000-4000-8000-000000000000', versionSesion: 1 });
    expect(await sesion(cookie)).toBeNull();
  });

  it('si versionSesion cambió, tras invalidarUsuario → null', async () => {
    const { usuario, membresia } = await escenario();
    const { sesion, invalidarUsuario } = preparar();
    const cookie = await cookieDeSesion(contenidoConEmpresa(usuario, membresia));
    expect(await sesion(cookie)).not.toBeNull();
    await prismaPrueba.usuario.update({ where: { id: usuario.id }, data: { versionSesion: { increment: 1 } } });
    invalidarUsuario(usuario.id);
    expect(await sesion(cookie)).toBeNull();
  });

  it('si la membresía se borró, tras invalidarMembresia → SesionUsuario', async () => {
    const { usuario, membresia } = await escenario();
    const { sesion, invalidarMembresia } = preparar();
    const cookie = await cookieDeSesion(contenidoConEmpresa(usuario, membresia));
    expect(await sesion(cookie)).toMatchObject({ rol: 'RECLUTADOR' });
    await prismaPrueba.membresia.delete({ where: { id: membresia.id } });
    invalidarMembresia(membresia.id);
    expect(await sesion(cookie)).toEqual({ usuarioId: usuario.id, esSuperadmin: false });
  });

  it('si la version de la membresía subió, tras invalidarMembresia → SesionUsuario', async () => {
    const { usuario, membresia } = await escenario();
    const { sesion, invalidarMembresia } = preparar();
    const cookie = await cookieDeSesion(contenidoConEmpresa(usuario, membresia));
    expect(await sesion(cookie)).toMatchObject({ rol: 'RECLUTADOR' });
    await prismaPrueba.membresia.update({ where: { id: membresia.id }, data: { version: { increment: 1 }, rol: 'ADMIN' } });
    invalidarMembresia(membresia.id);
    expect(await sesion(cookie)).toEqual({ usuarioId: usuario.id, esSuperadmin: false });
  });

  it('si la empresa quedó SUSPENDIDA, tras invalidarMembresia → sin empresa', async () => {
    const { org, usuario, membresia } = await escenario();
    const { sesion, invalidarMembresia } = preparar();
    const cookie = await cookieDeSesion(contenidoConEmpresa(usuario, membresia));
    expect(await sesion(cookie)).toMatchObject({ organizacionId: org.id });
    await prismaPrueba.organizacion.update({ where: { id: org.id }, data: { estadoVerificacion: 'SUSPENDIDA' } });
    invalidarMembresia(membresia.id);
    expect(await sesion(cookie)).toEqual({ usuarioId: usuario.id, esSuperadmin: false });
  });

  it('caché: un cambio sin invalidar se refleja al vencer el TTL y no antes', async () => {
    const { usuario, membresia } = await escenario();
    let ahora = Date.now();
    const { sesion } = preparar(() => ahora);
    const cookie = await cookieDeSesion(contenidoConEmpresa(usuario, membresia));
    expect(await sesion(cookie)).toMatchObject({ rol: 'RECLUTADOR' });

    await prismaPrueba.membresia.update({ where: { id: membresia.id }, data: { version: { increment: 1 } } });
    ahora += 59_999;
    expect(await sesion(cookie)).toMatchObject({ rol: 'RECLUTADOR' });
    ahora += 1;
    expect(await sesion(cookie)).toEqual({ usuarioId: usuario.id, esSuperadmin: false });

    await prismaPrueba.usuario.update({ where: { id: usuario.id }, data: { versionSesion: { increment: 1 } } });
    expect(await sesion(cookie)).toEqual({ usuarioId: usuario.id, esSuperadmin: false });
    ahora += 60_000;
    expect(await sesion(cookie)).toBeNull();
  });

  it('el token de A con el mid de una membresía de B → sin empresa', async () => {
    const a = await escenario();
    const b = await escenario();
    const { sesion } = preparar();
    const cookie = await cookieDeSesion({
      usuarioId: a.usuario.id,
      versionSesion: a.usuario.versionSesion,
      empresa: { organizacionId: b.org.id, membresiaId: b.membresia.id, versionMembresia: b.membresia.version },
    });
    expect(await sesion(cookie)).toEqual({ usuarioId: a.usuario.id, esSuperadmin: false });
  });

  it('el org del token debe coincidir con el de la membresía', async () => {
    const { usuario, membresia } = await escenario();
    const otra = await crearOrganizacion();
    const { sesion } = preparar();
    const contenido = contenidoConEmpresa(usuario, membresia);
    const cookie = await cookieDeSesion({ ...contenido, empresa: { ...contenido.empresa!, organizacionId: otra.id } });
    expect(await sesion(cookie)).toEqual({ usuarioId: usuario.id, esSuperadmin: false });
  });

  it('la guardia TENANT acepta la sesión con empresa y rechaza con SIN_EMPRESA la que no la tiene', async () => {
    const { org, usuario, membresia } = await escenario();
    const { app } = preparar();
    const conEmpresa = await cookieDeSesion(contenidoConEmpresa(usuario, membresia));
    const ok = await request(app).get('/api/prueba/tenant').set('Cookie', conEmpresa).expect(200);
    expect(ok.body).toMatchObject({ organizacionId: org.id, rol: 'RECLUTADOR' });

    const sinEmpresa = await cookieDeSesion({ usuarioId: usuario.id, versionSesion: usuario.versionSesion });
    const res = await request(app).get('/api/prueba/tenant').set('Cookie', sinEmpresa).expect(403);
    expect(res.body.error.code).toBe('SIN_EMPRESA');
    await request(app).get('/api/prueba/tenant').expect(401);
  });
});
