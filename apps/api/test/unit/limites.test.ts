import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearLimitador } from '../../src/http/limites';
import { manejadorErrores } from '../../src/http/manejador-errores';

describe('crearLimitador con clave propia', () => {
  it('cuenta por la clave entregada', async () => {
    const app = express();
    app.use(crearLimitador({ ventanaMs: 60_000, maximo: 1, clave: (req) => String(req.query.k) }));
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(manejadorErrores);
    expect((await request(app).get('/?k=a')).status).toBe(200);
    expect((await request(app).get('/?k=a')).status).toBe(429);
    expect((await request(app).get('/?k=b')).status).toBe(200);
  });

  it('cada limitador tiene su propio contador', async () => {
    const construir = () => {
      const app = express();
      app.use(crearLimitador({ ventanaMs: 60_000, maximo: 1 }));
      app.get('/', (_req, res) => {
        res.json({ ok: true });
      });
      app.use(manejadorErrores);
      return app;
    };
    const a = construir();
    const b = construir();
    expect((await request(a).get('/')).status).toBe(200);
    expect((await request(b).get('/')).status).toBe(200);
  });
});
