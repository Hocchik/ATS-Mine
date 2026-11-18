import { describe, expect, it } from 'vitest';
import { crearApp, type Modulo } from '../../src/app';
import type { EscenarioAislamiento } from '../../src/http/registro';
import { sinSesion } from '../../src/http/sesion';
import { crearLogger } from '../../src/logger';
import { SEGURIDAD_PRUEBA } from '../sesion-real';
import { rutasSinRegistrar } from './rutas-express';

const escenario: EscenarioAislamiento = { preparar: async () => ({ tipo: 'COLECCION', ruta: '/api/x', marcador: 'x' }) };
const ok: Parameters<Parameters<Modulo>[0]['registro']['definir']>[2] = (_req, res) => {
  res.json({});
};

const appCon = (...modulos: Modulo[]) =>
  crearApp({ logger: crearLogger('silent'), resolverSesion: sinSesion, seguridad: SEGURIDAD_PRUEBA, modulos });

// Estas pruebas montan rutas por fuera del registro a propósito.
describe('rutasSinRegistrar', () => {
  it('no reporta nada si todo pasó por definir, ni el middleware propio de la app (helmet, json, edge, 404…)', () => {
    const { app, registro } = appCon(({ registro, router }) => {
      registro.definir(router, { metodo: 'get', ruta: '/health', acceso: 'PUBLICA' }, ok);
      registro.definir(router, { metodo: 'get', ruta: '/api/x/:id', acceso: 'TENANT', aislamiento: escenario }, ok);
    });
    expect(rutasSinRegistrar(app, registro.definiciones)).toEqual([]);
  });

  it('reporta un middleware montado con router.use(ruta, fn) dentro de un router de módulo', () => {
    const { app, registro } = appCon(({ router }) => {
      router.use('/api/oculta', function oculta(_req, res) {
        res.json({ fuga: true });
      });
    });
    expect(rutasSinRegistrar(app, registro.definiciones)).toEqual(['USE oculta']);
  });

  it('reporta un handler directo montado antes de un definir con la misma ruta (lo sombrea)', () => {
    const { app, registro } = appCon(({ registro, router }) => {
      router.get('/api/sombra', ok);
      registro.definir(router, { metodo: 'get', ruta: '/api/sombra', acceso: 'TENANT', aislamiento: escenario }, ok);
    });
    expect(rutasSinRegistrar(app, registro.definiciones)).toEqual(['GET /api/sombra (montada 2 veces, registrada 1)']);
  });

  it('cuenta sin distinguir mayúsculas ni barra final: una variante directa también es duplicada', () => {
    const { app, registro } = appCon(({ registro, router }) => {
      registro.definir(router, { metodo: 'get', ruta: '/api/dup', acceso: 'PUBLICA' }, ok);
      router.get('/API/Dup/', ok);
    });
    expect(rutasSinRegistrar(app, registro.definiciones)).toEqual(['GET /api/dup (montada 2 veces, registrada 1)']);
  });

  it('una variante de mayúsculas a través de definir lanza al registrarla', () => {
    expect(() =>
      appCon(({ registro, router }) => {
        registro.definir(router, { metodo: 'get', ruta: '/api/p/Dup', acceso: 'PUBLICA' }, ok);
        registro.definir(router, { metodo: 'get', ruta: '/api/p/dup', acceso: 'TENANT', aislamiento: escenario }, ok);
      }),
    ).toThrow(/duplicada/);
  });

  it('reporta router.route().get() y router.all()', () => {
    const { app, registro } = appCon(({ router }) => {
      router.route('/api/cadena').get(ok);
      router.all('/api/todo', ok);
    });
    expect(rutasSinRegistrar(app, registro.definiciones)).toEqual(['GET /api/cadena', '_ALL /api/todo']);
  });
});
