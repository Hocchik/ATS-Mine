import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp, type Modulo } from '../../src/app';
import { crearResolverSesion } from '../../src/auth/resolver-sesion';
import type { DefinicionRuta } from '../../src/http/registro';
import { crearLogger } from '../../src/logger';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { cabecerasDeSesionReal, SECRETO_PRUEBA, SEGURIDAD_PRUEBA } from '../sesion-real';
import { verificarAislamiento } from './verificar';

const ok: Parameters<Parameters<Modulo>[0]['registro']['definir']>[2] = (_req, res) => {
  res.json({ ok: true });
};

const moduloAccesos: Modulo = ({ registro, router }) => {
  // Bien protegidas: el verificador no debe reportarlas.
  registro.definir(router, { metodo: 'get', ruta: '/api/prueba/admin/organizaciones', acceso: 'PLATAFORMA' }, ok);
  registro.definir(router, { metodo: 'post', ruta: '/api/prueba/admin/organizaciones/:id/verificar', acceso: 'PLATAFORMA' }, ok);
  registro.definir(
    router,
    { metodo: 'get', ruta: '/api/prueba/yo', acceso: 'AUTENTICADA', aislamiento: { noAplica: 'solo datos de la propia persona' } },
    ok,
  );
  // Mal protegidas: se registran como AUTENTICADA (sin exigirSuperadmin) y se declaran PLATAFORMA ante el verificador.
  registro.definir(
    router,
    { metodo: 'get', ruta: '/api/prueba/admin/olvidada', acceso: 'AUTENTICADA', aislamiento: { noAplica: 'x' } },
    ok,
  );
  registro.definir(
    router,
    { metodo: 'post', ruta: '/api/prueba/admin/olvidada/:id', acceso: 'AUTENTICADA', aislamiento: { noAplica: 'x' } },
    ok,
  );
};

const OLVIDADAS = new Set(['/api/prueba/admin/olvidada', '/api/prueba/admin/olvidada/:id']);

beforeEach(limpiarBase);

describe('verificarAislamiento con accesos AUTENTICADA y PLATAFORMA', () => {
  it('detecta una ruta PLATAFORMA que olvida exigirSuperadmin y cuenta las AUTENTICADA noAplica sin probarlas', async () => {
    const { app, registro } = crearApp({
      logger: crearLogger('silent'),
      resolverSesion: crearResolverSesion({ prisma: extenderConTenant(prismaPrueba), secreto: SECRETO_PRUEBA }).resolver,
      seguridad: SEGURIDAD_PRUEBA,
      modulos: [moduloAccesos],
    });
    const definiciones: DefinicionRuta[] = registro.definiciones.map((d) =>
      OLVIDADAS.has(d.ruta) ? { metodo: d.metodo, ruta: d.ruta, acceso: 'PLATAFORMA' } : d,
    );

    const resultado = await verificarAislamiento({
      app,
      definiciones,
      prisma: prismaPrueba,
      sesionPara: cabecerasDeSesionReal,
    });

    expect(resultado.revisadas).toBe(5);
    expect(resultado.fallos).toEqual([
      { ruta: 'GET /api/prueba/admin/olvidada', motivo: expect.stringContaining('esperaba 403') },
      { ruta: 'POST /api/prueba/admin/olvidada/:id', motivo: expect.stringContaining('esperaba 403') },
    ]);
  });

  it('una ruta AUTENTICADA sin aislamiento declarado es un fallo', async () => {
    const { app } = crearApp({
      logger: crearLogger('silent'),
      resolverSesion: async () => null,
      seguridad: SEGURIDAD_PRUEBA,
      modulos: [],
    });
    const resultado = await verificarAislamiento({
      app,
      definiciones: [{ metodo: 'get', ruta: '/api/yo', acceso: 'AUTENTICADA' }],
      prisma: prismaPrueba,
      sesionPara: cabecerasDeSesionReal,
    });
    expect(resultado).toEqual({ revisadas: 1, fallos: [{ ruta: 'GET /api/yo', motivo: 'sin escenario de aislamiento' }] });
  });
});
