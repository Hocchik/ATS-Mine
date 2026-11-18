import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp, type Modulo } from '../../src/app';
import { crearResolverSesion } from '../../src/auth/resolver-sesion';
import type { Acceso, DefinicionRuta } from '../../src/http/registro';
import { AppError } from '../../src/http/errores';
import { crearLogger } from '../../src/logger';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearUsuario } from '../fabricas';
import { cabecerasDeSesionReal, SECRETO_PRUEBA, SEGURIDAD_PRUEBA } from '../sesion-real';
import { verificarAislamiento } from './verificar';

const prismaTenant = extenderConTenant(prismaPrueba);
const resolverReal = () => crearResolverSesion({ prisma: prismaTenant, secreto: SECRETO_PRUEBA }).resolver;

const crearMembresiaEn = async (organizacionId: string) => {
  const usuario = await crearUsuario();
  return crearMembresia(usuario.id, organizacionId, 'RECLUTADOR');
};

const moduloConFugas: Modulo = ({ registro, router }) => {
  registro.definir(
    router,
    {
      metodo: 'get',
      ruta: '/api/prueba/membresias/:id',
      acceso: 'TENANT',
      aislamiento: {
        preparar: async ({ organizacionId }) => {
          const m = await crearMembresiaEn(organizacionId);
          return { tipo: 'RECURSO', ruta: `/api/prueba/membresias/${m.id}` };
        },
      },
    },
    async (req, res) => {
      const m = await prismaTenant.membresia.findUnique({ where: { id: String(req.params.id) } });
      if (!m) throw new AppError('NOT_FOUND', 'No encontrado');
      res.json(m);
    },
  );
  registro.definir(
    router,
    {
      metodo: 'get',
      ruta: '/api/prueba/fuga/:id',
      acceso: 'TENANT',
      aislamiento: {
        preparar: async ({ organizacionId }) => {
          const m = await crearMembresiaEn(organizacionId);
          return { tipo: 'RECURSO', ruta: `/api/prueba/fuga/${m.id}` };
        },
      },
    },
    async (req, res) => {
      // Fuga deliberada: usa el cliente sin filtro multiempresa.
      const m = await prismaPrueba.membresia.findUnique({ where: { id: String(req.params.id) } });
      if (!m) throw new AppError('NOT_FOUND', 'No encontrado');
      res.json(m);
    },
  );
  registro.definir(
    router,
    {
      metodo: 'get',
      ruta: '/api/prueba/membresias',
      acceso: 'TENANT',
      aislamiento: {
        preparar: async ({ organizacionId }) => {
          const m = await crearMembresiaEn(organizacionId);
          return { tipo: 'COLECCION', ruta: '/api/prueba/membresias', marcador: m.id };
        },
      },
    },
    async (_req, res) => {
      res.json(await prismaTenant.membresia.findMany());
    },
  );
  registro.definir(
    router,
    {
      metodo: 'get',
      ruta: '/api/prueba/fuga-lista',
      acceso: 'TENANT',
      aislamiento: {
        preparar: async ({ organizacionId }) => {
          const m = await crearMembresiaEn(organizacionId);
          return { tipo: 'COLECCION', ruta: '/api/prueba/fuga-lista', marcador: m.id };
        },
      },
    },
    async (_req, res) => {
      res.json(await prismaPrueba.membresia.findMany());
    },
  );
  registro.definir(
    router,
    {
      metodo: 'get',
      ruta: '/api/prueba/segura-ruta-mala/:id',
      acceso: 'TENANT',
      aislamiento: {
        preparar: async ({ organizacionId }) => {
          const m = await crearMembresiaEn(organizacionId);
          return { tipo: 'RECURSO', ruta: `/api/prueba/inexistente/${m.id}` };
        },
      },
    },
    async (req, res) => {
      const m = await prismaTenant.membresia.findUnique({ where: { id: String(req.params.id) } });
      if (!m) throw new AppError('NOT_FOUND', 'No encontrado');
      res.json(m);
    },
  );
  registro.definir(
    router,
    {
      metodo: 'get',
      ruta: '/api/prueba/muerta/:id',
      acceso: 'TENANT',
      aislamiento: {
        preparar: async ({ organizacionId }) => {
          const m = await crearMembresiaEn(organizacionId);
          return { tipo: 'RECURSO', ruta: `/api/prueba/muerta/${m.id}` };
        },
      },
    },
    async () => {
      throw new AppError('NOT_FOUND', 'Siempre no encontrado');
    },
  );
};

beforeEach(limpiarBase);

describe('verificarAislamiento', () => {
  it('detecta exactamente las rutas que filtran datos de otra empresa', async () => {
    const { app, registro } = crearApp({
      logger: crearLogger('silent'),
      resolverSesion: resolverReal(),
      seguridad: SEGURIDAD_PRUEBA,
      modulos: [moduloConFugas],
    });

    const resultado = await verificarAislamiento({
      app,
      definiciones: registro.definiciones,
      prisma: prismaPrueba,
      sesionPara: cabecerasDeSesionReal,
    });

    expect(resultado.revisadas).toBe(6);
    expect(resultado.fallos.map((f) => f.ruta).sort()).toEqual([
      'GET /api/prueba/fuga-lista',
      'GET /api/prueba/fuga/:id',
      'GET /api/prueba/muerta/:id',
      'GET /api/prueba/segura-ruta-mala/:id',
    ]);
    const motivo = (ruta: string) => resultado.fallos.find((f) => f.ruta === ruta)?.motivo;
    expect(motivo('GET /api/prueba/segura-ruta-mala/:id')).toEqual(
      expect.stringContaining('la ruta del escenario no coincide con la ruta registrada'),
    );
    expect(motivo('GET /api/prueba/muerta/:id')).toEqual(expect.stringContaining('control positivo'));
  });

  it('revisa toda ruta cuyo acceso no sea PUBLICA, no solo las TENANT', async () => {
    const { app } = crearApp({
      logger: crearLogger('silent'),
      resolverSesion: resolverReal(),
      seguridad: SEGURIDAD_PRUEBA,
      modulos: [],
    });
    const definiciones: DefinicionRuta[] = [
      { metodo: 'get', ruta: '/publica', acceso: 'PUBLICA' },
      { metodo: 'get', ruta: '/api/interna', acceso: 'INTERNA' as unknown as Acceso },
    ];
    const resultado = await verificarAislamiento({
      app,
      definiciones,
      prisma: prismaPrueba,
      sesionPara: cabecerasDeSesionReal,
    });
    expect(resultado.revisadas).toBe(1);
    expect(resultado.fallos).toEqual([{ ruta: 'GET /api/interna', motivo: 'sin escenario de aislamiento' }]);
  });
});
