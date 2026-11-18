import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp, type Modulo } from '../../src/app';
import { crearLogger } from '../../src/logger';
import { modulosDeLaApp } from '../../src/modulos';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { cabecerasDeSesion, resolverPrueba } from '../sesion-prueba';
import { rutasSinRegistrar } from './rutas-express';
import { verificarAislamiento } from './verificar';

beforeEach(limpiarBase);

const appReal = () =>
  crearApp({
    logger: crearLogger('silent'),
    resolverSesion: resolverPrueba,
    modulos: modulosDeLaApp({ prisma: extenderConTenant(prismaPrueba) }),
  });

describe('aislamiento entre empresas (todas las rutas de la app)', () => {
  it('ninguna ruta TENANT expone datos de otra empresa', async () => {
    const { app, registro } = appReal();

    expect(registro.definiciones.length).toBeGreaterThan(0);

    const { fallos } = await verificarAislamiento({
      app,
      definiciones: registro.definiciones,
      prisma: prismaPrueba,
      sesionPara: async (ids) => cabecerasDeSesion(ids),
    });

    expect(fallos).toEqual([]);
  });

  it('toda ruta de Express de la app real está en el registro', () => {
    const { app, registro } = appReal();
    expect(rutasSinRegistrar(app, registro.definiciones)).toEqual([]);
  });

  it('el recorrido detecta una ruta montada sin pasar por definir', () => {
    const saltada: Modulo = ({ router }) => {
      router.get('/api/saltada', (_req, res) => {
        res.json({});
      });
    };
    const { app, registro } = crearApp({
      logger: crearLogger('silent'),
      resolverSesion: resolverPrueba,
      modulos: [saltada],
    });
    expect(rutasSinRegistrar(app, registro.definiciones)).toEqual(['GET /api/saltada']);
  });
});
