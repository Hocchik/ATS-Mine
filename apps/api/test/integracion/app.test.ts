import { randomUUID } from 'node:crypto';
import { respuestaErrorSchema } from '@criterio/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp, type Modulo } from '../../src/app';
import { AppError } from '../../src/http/errores';
import { obtenerSesion } from '../../src/http/sesion';
import { crearLogger } from '../../src/logger';
import { moduloSistema } from '../../src/modulos/sistema';
import { contextoActual } from '../../src/tenant/contexto';
import { cabecerasDeSesion, resolverPrueba } from '../sesion-prueba';
import { SEGURIDAD_PRUEBA } from '../sesion-real';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const moduloDePrueba: Modulo = ({ registro, router }) => {
  registro.definir(router, { metodo: 'get', ruta: '/prueba/falla', acceso: 'PUBLICA' }, () => {
    throw new Error('detalle interno secreto');
  });
  registro.definir(router, { metodo: 'get', ruta: '/prueba/conflicto', acceso: 'PUBLICA' }, () => {
    throw new AppError('VERSION_CONFLICT', 'Otra persona actualizó este registro');
  });
  registro.definir(router, { metodo: 'get', ruta: '/prueba/parcial', acceso: 'PUBLICA' }, (_req, res, next) => {
    res.write('parcial');
    next(new Error('falla tras escribir'));
  });
  registro.definir(router, { metodo: 'post', ruta: '/prueba/eco', acceso: 'PUBLICA' }, (req, res) => {
    res.json(req.body);
  });
  registro.definir(
    router,
    {
      metodo: 'get',
      ruta: '/api/prueba/contexto',
      acceso: 'TENANT',
      aislamiento: { preparar: async () => ({ tipo: 'COLECCION', ruta: '/api/prueba/contexto', marcador: 'no-aplica' }) },
    },
    (_req, res) => {
      res.json({ contexto: contextoActual(), usuarioId: obtenerSesion(res).usuarioId });
    },
  );
  registro.definir(
    router,
    {
      metodo: 'post',
      ruta: '/api/prueba/contexto-cuerpo',
      acceso: 'TENANT',
      aislamiento: {
        preparar: async () => ({ tipo: 'COLECCION', ruta: '/api/prueba/contexto-cuerpo', marcador: 'no-aplica' }),
      },
    },
    (req, res) => {
      res.json({ contexto: contextoActual(), cuerpo: req.body });
    },
  );
};

function app() {
  return crearApp({
    logger: crearLogger('silent'),
    resolverSesion: resolverPrueba,
    seguridad: SEGURIDAD_PRUEBA,
    modulos: [moduloSistema(), moduloDePrueba],
  }).app;
}

describe('crearApp', () => {
  it('GET /health responde ok con X-Request-Id', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('ruta inexistente → 404 con el formato de error y el mismo requestId', async () => {
    const res = await request(app()).get('/no-existe');
    expect(res.status).toBe(404);
    expect(respuestaErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('error inesperado → 500 sin filtrar detalles internos', async () => {
    const res = await request(app()).get('/prueba/falla');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL', message: 'Error interno' });
    expect(res.text).not.toContain('secreto');
  });

  it('AppError conserva su status y código', async () => {
    const res = await request(app()).get('/prueba/conflicto');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('si ya se enviaron cabeceras, delega en Express y la respuesta termina sin romper el proceso', async () => {
    const instancia = app();
    // El manejador final de Express corta la conexión: la respuesta parcial termina abortada, sin intentar un 500.
    await expect(request(instancia).get('/prueba/parcial')).rejects.toThrow(/aborted|hang up|ECONNRESET/i);
    const despues = await request(instancia).get('/health');
    expect(despues.status).toBe(200);
  });

  it('JSON mal formado → 400 VALIDATION_FAILED', async () => {
    const res = await request(app()).post('/prueba/eco').set('Content-Type', 'application/json').send('{mal');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('ruta TENANT sin sesión → 401 UNAUTHENTICATED', async () => {
    const res = await request(app()).get('/api/prueba/contexto');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('ruta TENANT con sesión corre dentro del contexto de su empresa', async () => {
    const org = randomUUID();
    const usuarioId = randomUUID();
    const res = await request(app())
      .get('/api/prueba/contexto')
      .set(cabecerasDeSesion({ usuarioId, organizacionId: org }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contexto: { modo: 'tenant', organizacionId: org }, usuarioId });
  });

  it('ruta TENANT que lee el cuerpo JSON conserva el contexto de empresa', async () => {
    const org = randomUUID();
    const res = await request(app())
      .post('/api/prueba/contexto-cuerpo')
      .set(cabecerasDeSesion({ usuarioId: randomUUID(), organizacionId: org }))
      .set({ Cookie: 'criterio_csrf=token-csrf', 'X-CSRF-Token': 'token-csrf' })
      .send({ titulo: 'hola' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contexto: { modo: 'tenant', organizacionId: org }, cuerpo: { titulo: 'hola' } });
  });

  it('cabeceras de seguridad de helmet y sin x-powered-by', async () => {
    const res = await request(app()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
