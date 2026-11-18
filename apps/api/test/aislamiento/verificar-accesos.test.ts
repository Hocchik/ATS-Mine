import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp, type Modulo } from '../../src/app';
import { crearResolverSesion } from '../../src/auth/resolver-sesion';
import { AppError } from '../../src/http/errores';
import type { DefinicionRuta, EscenarioAislamiento } from '../../src/http/registro';
import { obtenerEmpresaActivaOpcional } from '../../src/http/sesion';
import { crearLogger } from '../../src/logger';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearUsuario } from '../fabricas';
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

describe('verificarAislamiento: roles en PLATAFORMA y TENANT', () => {
  const prismaTenant = extenderConTenant(prismaPrueba);
  const appCon = (modulo: Modulo) =>
    crearApp({
      logger: crearLogger('silent'),
      resolverSesion: crearResolverSesion({ prisma: prismaTenant, secreto: SECRETO_PRUEBA }).resolver,
      seguridad: SEGURIDAD_PRUEBA,
      modulos: [modulo],
    });

  it('una ruta "de plataforma" que solo rechaza a un OWNER, o solo a quien tiene empresa, se detecta', async () => {
    const { app, registro } = appCon(({ registro, router }) => {
      const autenticada = { acceso: 'AUTENTICADA', aislamiento: { noAplica: 'x' } } as const;
      registro.definir(router, { metodo: 'get', ruta: '/api/prueba/admin/solo-owner', ...autenticada }, (_req, res) => {
        if (obtenerEmpresaActivaOpcional(res)?.rol === 'OWNER') throw new AppError('FORBIDDEN', 'x');
        res.json({ ok: true });
      });
      registro.definir(router, { metodo: 'get', ruta: '/api/prueba/admin/con-empresa', ...autenticada }, (_req, res) => {
        if (obtenerEmpresaActivaOpcional(res)) throw new AppError('FORBIDDEN', 'x');
        res.json({ ok: true });
      });
    });
    const definiciones: DefinicionRuta[] = registro.definiciones.map((d) => ({ metodo: d.metodo, ruta: d.ruta, acceso: 'PLATAFORMA' }));
    const { fallos } = await verificarAislamiento({ app, definiciones, prisma: prismaPrueba, sesionPara: cabecerasDeSesionReal });
    expect(fallos.map((f) => f.ruta)).toEqual(['GET /api/prueba/admin/solo-owner', 'GET /api/prueba/admin/con-empresa']);
    expect(fallos[0]?.motivo).toEqual(expect.stringContaining('ADMIN'));
    expect(fallos[1]?.motivo).toEqual(expect.stringContaining('sin empresa'));
  });

  it('una ruta TENANT con roles se prueba con miembros de ese rol (control positivo e intrusa)', async () => {
    const membresiaEn = async (organizacionId: string) => crearMembresia((await crearUsuario()).id, organizacionId, 'RECLUTADOR');
    const coleccion: EscenarioAislamiento = {
      preparar: async ({ organizacionId }) => {
        const m = await membresiaEn(organizacionId);
        return { tipo: 'COLECCION', ruta: '/api/prueba/solo-admin', marcador: m.id };
      },
    };
    const recurso: EscenarioAislamiento = {
      preparar: async ({ organizacionId }) => {
        const m = await membresiaEn(organizacionId);
        return { tipo: 'RECURSO', ruta: `/api/prueba/solo-reclutador/${m.id}` };
      },
    };
    const { app, registro } = appCon(({ registro, router }) => {
      registro.definir(router, { metodo: 'get', ruta: '/api/prueba/solo-admin', acceso: 'TENANT', roles: ['ADMIN'], aislamiento: coleccion }, async (_req, res) => {
        res.json(await prismaTenant.membresia.findMany());
      });
      registro.definir(
        router,
        { metodo: 'get', ruta: '/api/prueba/solo-reclutador/:id', acceso: 'TENANT', roles: ['RECLUTADOR'], aislamiento: recurso },
        async (req, res) => {
          const m = await prismaTenant.membresia.findUnique({ where: { id: String(req.params.id) } });
          if (!m) throw new AppError('NOT_FOUND', 'No encontrado');
          res.json(m);
        },
      );
    });
    const resultado = await verificarAislamiento({
      app,
      definiciones: registro.definiciones,
      prisma: prismaPrueba,
      sesionPara: cabecerasDeSesionReal,
    });
    expect(resultado).toEqual({ revisadas: 2, fallos: [] });
  });
});
