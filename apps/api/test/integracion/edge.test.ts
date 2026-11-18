import { respuestaErrorSchema } from '@criterio/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { exigirEdge, ipCliente } from '../../src/http/edge';
import { crearLimitador } from '../../src/http/limites';
import { manejadorErrores } from '../../src/http/manejador-errores';
import { crearLogger } from '../../src/logger';
import { resolverPrueba } from '../sesion-prueba';
import { SEGURIDAD_PRUEBA } from '../sesion-real';

const EDGE = 'e'.repeat(40);

const appConEdge = (edgeSecret?: string) =>
  crearApp({
    logger: crearLogger('silent'),
    resolverSesion: resolverPrueba,
    seguridad: { ...SEGURIDAD_PRUEBA, edgeSecret },
    modulos: [
      ({ registro, router }) => {
        registro.definir(router, { metodo: 'get', ruta: '/api/x', acceso: 'PUBLICA' }, (_req, res) => {
          res.json({ ok: true });
        });
        registro.definir(router, { metodo: 'get', ruta: '/public/x', acceso: 'PUBLICA' }, (_req, res) => {
          res.json({ ok: true });
        });
      },
    ],
  }).app;

describe('exigirEdge', () => {
  it('sin cabecera responde 403 FORBIDDEN', async () => {
    const res = await request(appConEdge(EDGE)).get('/api/x');
    expect(res.status).toBe(403);
    expect(respuestaErrorSchema.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('con la cabecera correcta pasa', async () => {
    const res = await request(appConEdge(EDGE)).get('/api/x').set('x-criterio-edge', EDGE);
    expect(res.status).toBe(200);
  });

  it('con una incorrecta del mismo largo o de otro largo responde 403', async () => {
    const mismo = await request(appConEdge(EDGE)).get('/api/x').set('x-criterio-edge', 'f'.repeat(40));
    const otro = await request(appConEdge(EDGE)).get('/api/x').set('x-criterio-edge', 'corto');
    expect(mismo.status).toBe(403);
    expect(otro.status).toBe(403);
  });

  it('una cabecera no ASCII del mismo largo responde 403, no 500', async () => {
    const res = await request(appConEdge(EDGE)).get('/api/x').set('x-criterio-edge', 'é'.repeat(40));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('/public no exige la cabecera', async () => {
    const res = await request(appConEdge(EDGE)).get('/public/x');
    expect(res.status).toBe(200);
  });

  it('sin secreto configurado deja pasar', async () => {
    const res = await request(appConEdge()).get('/api/x');
    expect(res.status).toBe(200);
  });
});

function appIp(edgeSecret?: string) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(exigirEdge(edgeSecret));
  app.get('/ip', (req, res) => {
    res.json({ ip: ipCliente(req, res) });
  });
  return app;
}

describe('ipCliente', () => {
  it('con edge verificado usa x-vercel-forwarded-for (primer valor) y luego x-real-ip', async () => {
    const a = await request(appIp(EDGE))
      .get('/ip')
      .set('x-criterio-edge', EDGE)
      .set('x-vercel-forwarded-for', ' 203.0.113.7 , 10.0.0.1');
    expect(a.body.ip).toBe('203.0.113.7');
    const b = await request(appIp(EDGE)).get('/ip').set('x-criterio-edge', EDGE).set('x-real-ip', '198.51.100.4');
    expect(b.body.ip).toBe('198.51.100.4');
  });

  it('sin edge ignora x-vercel-forwarded-for', async () => {
    const res = await request(appIp()).get('/ip').set('x-vercel-forwarded-for', '6.6.6.6').set('x-real-ip', '7.7.7.7');
    expect(res.body.ip).not.toBe('6.6.6.6');
    expect(res.body.ip).not.toBe('7.7.7.7');
  });
});

describe('crearLimitador', () => {
  function appLimitada() {
    const app = express();
    app.use(exigirEdge(EDGE));
    app.use(crearLimitador({ ventanaMs: 60_000, maximo: 2 }));
    app.get('/l', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(manejadorErrores);
    return app;
  }

  it('la tercera petición da 429 con el formato de error propio', async () => {
    const app = appLimitada();
    const pedir = () => request(app).get('/l').set('x-criterio-edge', EDGE).set('x-vercel-forwarded-for', '1.1.1.1');
    expect((await pedir()).status).toBe(200);
    expect((await pedir()).status).toBe(200);
    const res = await pedir();
    expect(res.status).toBe(429);
    expect(respuestaErrorSchema.parse(res.body).error.code).toBe('RATE_LIMITED');
  });

  it('separa el contador por IP', async () => {
    const app = appLimitada();
    const desde = (ip: string) => request(app).get('/l').set('x-criterio-edge', EDGE).set('x-vercel-forwarded-for', ip);
    await desde('1.1.1.1');
    await desde('1.1.1.1');
    expect((await desde('1.1.1.1')).status).toBe(429);
    expect((await desde('2.2.2.2')).status).toBe(200);
  });
});
