import { describe, expect, it } from 'vitest';
import { cargarConfig } from '../../src/config';

const BASE = {
  DATABASE_URL: 'postgresql://u:[REDACTADO]@localhost:5432/x',
  JWT_SECRET: 'j'.repeat(32),
  WEB_ORIGIN: 'http://localhost:5173',
};

describe('cargarConfig', () => {
  it('aplica valores por defecto', () => {
    const c = cargarConfig(BASE);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe('development');
    expect(c.LOG_LEVEL).toBe('info');
  });

  it('convierte PORT a número', () => {
    const c = cargarConfig({ ...BASE, PORT: '8080' });
    expect(c.PORT).toBe(8080);
  });

  it('falla si falta DATABASE_URL, nombrando la variable', () => {
    expect(() => cargarConfig({ JWT_SECRET: BASE.JWT_SECRET, WEB_ORIGIN: BASE.WEB_ORIGIN })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('falla sin JWT_SECRET, nombrando la variable', () => {
    const { JWT_SECRET: _omitido, ...sinSecreto } = BASE;
    expect(() => cargarConfig(sinSecreto)).toThrow(/JWT_SECRET/);
  });

  it('falla si JWT_SECRET tiene menos de 32 caracteres', () => {
    expect(() => cargarConfig({ ...BASE, JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
  });

  it.each(['no-es-url', 'ftp://x.com', 'https://criterio.app/'])('rechaza WEB_ORIGIN %s', (origen) => {
    expect(() => cargarConfig({ ...BASE, WEB_ORIGIN: origen })).toThrow(/WEB_ORIGIN/);
  });

  it('en production exige EDGE_SECRET', () => {
    expect(() => cargarConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(/EDGE_SECRET/);
  });

  it('en production acepta EDGE_SECRET válido', () => {
    const c = cargarConfig({ ...BASE, NODE_ENV: 'production', EDGE_SECRET: 'e'.repeat(32) });
    expect(c.EDGE_SECRET).toBe('e'.repeat(32));
  });

  it('en development no exige EDGE_SECRET', () => {
    const c = cargarConfig({ ...BASE, NODE_ENV: 'development' });
    expect(c.EDGE_SECRET).toBeUndefined();
  });
});
