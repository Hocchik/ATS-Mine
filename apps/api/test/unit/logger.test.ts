import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { sinSesion } from '../../src/http/sesion';
import { crearLogger } from '../../src/logger';
import { moduloSistema } from '../../src/modulos/sistema';

function capturar() {
  const lineas: string[] = [];
  const destino = new Writable({
    write(chunk, _enc, cb) {
      lineas.push(chunk.toString());
      cb();
    },
  });
  return { lineas, destino };
}

describe('crearLogger', () => {
  it('oculta datos personales y secretos', () => {
    const { lineas, destino } = capturar();
    const logger = crearLogger('info', destino);
    logger.info(
      {
        candidato: { email: 'ana@ejemplo.test', telefono: '999888777', documento: '12345678' },
        cv: { textoExtraido: 'Ana Pérez, 10 años en ventas' },
        sesion: { token: 'secreto' },
      },
      'evento',
    );
    const salida = lineas.join('');
    expect(salida).not.toContain('ana@ejemplo.test');
    expect(salida).not.toContain('999888777');
    expect(salida).not.toContain('12345678');
    expect(salida).not.toContain('Ana Pérez');
    expect(salida).not.toContain('secreto');
    expect(salida).toContain('[oculto]');
  });

  it('oculta la cookie de las peticiones', () => {
    const { lineas, destino } = capturar();
    const logger = crearLogger('info', destino);
    logger.info({ req: { headers: { cookie: 'sesion=abc' } } }, 'peticion');
    expect(lineas.join('')).not.toContain('sesion=abc');
  });

  it('oculta datos personales en la raíz y a dos niveles de profundidad', () => {
    const { lineas, destino } = capturar();
    const logger = crearLogger('info', destino);
    logger.info({ email: 'raiz@ejemplo.test' }, 'raiz');
    logger.info({ postulacion: { candidato: { telefono: '911222333' } } }, 'profundo');
    const salida = lineas.join('');
    expect(salida).not.toContain('raiz@ejemplo.test');
    expect(salida).not.toContain('911222333');
  });

  it.each(['contrasena', 'tokenHash', 'secreto'])('oculta el campo %s', (campo) => {
    const { lineas, destino } = capturar();
    crearLogger('info', destino).info({ [campo]: 'valor-sensible', anidado: { [campo]: 'valor-sensible' } }, 'x');
    expect(lineas.join('')).not.toContain('valor-sensible');
  });

  it('oculta la cabecera del secreto de edge', () => {
    const { lineas, destino } = capturar();
    crearLogger('info', destino).info({ req: { headers: { 'x-criterio-edge': 'secreto-edge' } } }, 'peticion');
    expect(lineas.join('')).not.toContain('secreto-edge');
  });
});

describe('logs de peticiones HTTP', () => {
  it('registran la url sin la query string ni la cabecera de edge', async () => {
    const { lineas, destino } = capturar();
    const { app } = crearApp({
      logger: crearLogger('info', destino),
      resolverSesion: sinSesion,
      webOrigin: 'http://localhost:5173',
      modulos: [moduloSistema()],
    });
    await request(app).get('/health?email=ana@ejemplo.test&q=dato-de-busqueda').set('x-criterio-edge', 'secreto-edge').expect(200);
    const salida = lineas.join('');
    expect(salida).toContain('"url":"/health"');
    expect(salida).not.toContain('ana@ejemplo.test');
    expect(salida).not.toContain('dato-de-busqueda');
    expect(salida).not.toContain('secreto-edge');
  });
});
