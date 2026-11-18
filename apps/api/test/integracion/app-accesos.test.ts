import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp, type Modulo } from '../../src/app';
import { crearResolverSesion } from '../../src/auth/resolver-sesion';
import { obtenerEmpresaActivaOpcional, obtenerSesion, obtenerSesionEmpresa } from '../../src/http/sesion';
import { crearLogger } from '../../src/logger';
import { contextoActual } from '../../src/tenant/contexto';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';
import { cabecerasDeSesionReal, cookieDeSesion, SECRETO_PRUEBA, SEGURIDAD_PRUEBA } from '../sesion-real';

const sinEscenario = { preparar: async () => ({ tipo: 'COLECCION' as const, ruta: '/api/x', marcador: 'no-aplica' }) };

const moduloAccesos: Modulo = ({ registro, router }) => {
  const responder: Parameters<typeof registro.definir>[2] = (_req, res) => {
    res.json({ usuarioId: obtenerSesion(res).usuarioId, contexto: contextoActual() ?? null });
  };
  const autenticada = { acceso: 'AUTENTICADA', aislamiento: { noAplica: 'datos propios' } } as const;
  registro.definir(router, { metodo: 'get', ruta: '/api/prueba/yo', ...autenticada }, responder);
  registro.definir(router, { metodo: 'post', ruta: '/api/prueba/yo', ...autenticada }, responder);
  registro.definir(router, { metodo: 'get', ruta: '/api/prueba/tenant', acceso: 'TENANT', aislamiento: sinEscenario }, responder);
  registro.definir(router, { metodo: 'post', ruta: '/api/prueba/tenant', acceso: 'TENANT', aislamiento: sinEscenario }, responder);
  registro.definir(
    router,
    { metodo: 'get', ruta: '/api/prueba/solo-owner', acceso: 'TENANT', roles: ['OWNER'], aislamiento: sinEscenario },
    responder,
  );
  registro.definir(router, { metodo: 'get', ruta: '/api/prueba/plataforma', acceso: 'PLATAFORMA' }, responder);
  registro.definir(router, { metodo: 'get', ruta: '/api/prueba/yo-detalle', ...autenticada }, (_req, res) => {
    res.json({ sesion: obtenerSesion(res), empresaActiva: obtenerEmpresaActivaOpcional(res) });
  });
  registro.definir(router, { metodo: 'get', ruta: '/api/prueba/yo-empresa', ...autenticada }, (_req, res) => {
    res.json(obtenerSesionEmpresa(res));
  });
};

const app = () =>
  crearApp({
    logger: crearLogger('silent'),
    resolverSesion: crearResolverSesion({ prisma: extenderConTenant(prismaPrueba), secreto: SECRETO_PRUEBA }).resolver,
    seguridad: SEGURIDAD_PRUEBA,
    modulos: [moduloAccesos],
  }).app;

async function personaConEmpresa(rol: 'OWNER' | 'ADMIN' | 'RECLUTADOR') {
  const usuario = await crearUsuario();
  const org = await crearOrganizacion();
  await crearMembresia(usuario.id, org.id, rol);
  return { usuario, org, cabeceras: await cabecerasDeSesionReal({ usuarioId: usuario.id, organizacionId: org.id }) };
}

beforeEach(limpiarBase);

describe('accesos del registro con el resolver real', () => {
  it('AUTENTICADA sin cookie → 401 UNAUTHENTICATED (antes que el CSRF)', async () => {
    for (const metodo of ['get', 'post'] as const) {
      const res = await request(app())[metodo]('/api/prueba/yo');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('AUTENTICADA con sesión sin empresa → 200, fuera de cualquier contexto de empresa', async () => {
    const usuario = await crearUsuario();
    const cookie = await cookieDeSesion({ usuarioId: usuario.id, versionSesion: usuario.versionSesion });
    const res = await request(app()).get('/api/prueba/yo').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuarioId: usuario.id, contexto: null });
  });

  it('AUTENTICADA guarda la sesión sin empresa; la empresa activa solo se lee aparte', async () => {
    const { usuario, org, cabeceras } = await personaConEmpresa('ADMIN');
    const res = await request(app()).get('/api/prueba/yo-detalle').set(cabeceras);
    expect(res.status).toBe(200);
    expect(res.body.sesion).toEqual({ usuarioId: usuario.id, esSuperadmin: false });
    expect(res.body.empresaActiva).toEqual({ organizacionId: org.id, membresiaId: expect.any(String), rol: 'ADMIN' });

    const sinEmpresa = await request(app())
      .get('/api/prueba/yo-detalle')
      .set(await cabecerasDeSesionReal({ usuarioId: (await crearUsuario()).id }));
    expect(sinEmpresa.body.empresaActiva).toBeNull();
  });

  it('obtenerSesionEmpresa en una ruta AUTENTICADA → 403 SIN_EMPRESA aunque la cookie tenga empresa', async () => {
    const { cabeceras } = await personaConEmpresa('OWNER');
    const res = await request(app()).get('/api/prueba/yo-empresa').set(cabeceras);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIN_EMPRESA');
  });

  it('TENANT con sesión sin empresa → 403 SIN_EMPRESA', async () => {
    const usuario = await crearUsuario();
    const res = await request(app())
      .get('/api/prueba/tenant')
      .set(await cabecerasDeSesionReal({ usuarioId: usuario.id }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIN_EMPRESA');
  });

  it('TENANT con empresa corre en su contexto, también en POST con CSRF', async () => {
    const { usuario, org, cabeceras } = await personaConEmpresa('RECLUTADOR');
    for (const metodo of ['get', 'post'] as const) {
      const res = await request(app())[metodo]('/api/prueba/tenant').set(cabeceras);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ usuarioId: usuario.id, contexto: { modo: 'tenant', organizacionId: org.id } });
    }
  });

  it('TENANT POST sin CSRF → 403 CSRF_INVALIDO', async () => {
    const { cabeceras } = await personaConEmpresa('OWNER');
    const res = await request(app()).post('/api/prueba/tenant').set({ Cookie: cabeceras.Cookie ?? '' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALIDO');
  });

  it("TENANT con roles: ['OWNER'] → 403 FORBIDDEN a un RECLUTADOR y 200 a un OWNER", async () => {
    const reclutador = await personaConEmpresa('RECLUTADOR');
    const denegada = await request(app()).get('/api/prueba/solo-owner').set(reclutador.cabeceras);
    expect(denegada.status).toBe(403);
    expect(denegada.body.error.code).toBe('FORBIDDEN');

    const owner = await personaConEmpresa('OWNER');
    expect((await request(app()).get('/api/prueba/solo-owner').set(owner.cabeceras)).status).toBe(200);
  });

  it('PLATAFORMA → 403 FORBIDDEN a un no superadmin (aunque sea OWNER) y 200 a un superadmin', async () => {
    const { cabeceras } = await personaConEmpresa('OWNER');
    const denegada = await request(app()).get('/api/prueba/plataforma').set(cabeceras);
    expect(denegada.status).toBe(403);
    expect(denegada.body.error.code).toBe('FORBIDDEN');

    const creado = await crearUsuario();
    const superadmin = await prismaPrueba.usuario.update({ where: { id: creado.id }, data: { esSuperadmin: true } });
    const res = await request(app())
      .get('/api/prueba/plataforma')
      .set(await cabecerasDeSesionReal({ usuarioId: superadmin.id }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuarioId: superadmin.id, contexto: null });
  });
});

describe('CSRF de doble envío y Origin', () => {
  async function sesion() {
    const usuario = await crearUsuario();
    return cabecerasDeSesionReal({ usuarioId: usuario.id });
  }

  const esCsrfInvalido = (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALIDO');
  };

  it('POST sin X-CSRF-Token → 403 CSRF_INVALIDO', async () => {
    const { 'X-CSRF-Token': _token, ...resto } = await sesion();
    esCsrfInvalido(await request(app()).post('/api/prueba/yo').set(resto));
  });

  it('POST con un token distinto de la cookie → 403 CSRF_INVALIDO', async () => {
    const cabeceras = await sesion();
    esCsrfInvalido(await request(app()).post('/api/prueba/yo').set({ ...cabeceras, 'X-CSRF-Token': 'x'.repeat(43) }));
  });

  it('POST con un Origin ajeno → 403 CSRF_INVALIDO', async () => {
    const cabeceras = await sesion();
    esCsrfInvalido(await request(app()).post('/api/prueba/yo').set({ ...cabeceras, Origin: 'https://malicioso.test' }));
  });

  it('cookie CSRF que cookie-parser convierte en objeto (j:{...}) → 403 CSRF_INVALIDO, no 500', async () => {
    const { Cookie, Origin } = await sesion();
    const res = await request(app())
      .post('/api/prueba/yo')
      .set({ Cookie: `${(Cookie ?? '').split(';')[0]}; criterio_csrf=${encodeURIComponent('j:{"a":1}')}`, Origin: Origin ?? '' })
      .set('X-CSRF-Token', '[object Object]');
    esCsrfInvalido(res);
  });

  it('POST con todo correcto → 200, con o sin Origin', async () => {
    const cabeceras = await sesion();
    expect((await request(app()).post('/api/prueba/yo').set(cabeceras)).status).toBe(200);
    const { Origin: _origen, ...sinOrigen } = cabeceras;
    expect((await request(app()).post('/api/prueba/yo').set(sinOrigen)).status).toBe(200);
  });

  it('GET sin CSRF ni Origin → 200', async () => {
    const { Cookie } = await sesion();
    expect((await request(app()).get('/api/prueba/yo').set({ Cookie: Cookie ?? '' })).status).toBe(200);
  });
});
