import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { verificarCsrf, verificarOrigen } from '../../src/http/csrf';

const ORIGEN = 'https://app.criterio.test';

function peticion(metodo: string, cabeceras: Record<string, string> = {}, cookies: Record<string, unknown> = {}) {
  const minus = Object.fromEntries(Object.entries(cabeceras).map(([k, v]) => [k.toLowerCase(), v]));
  return { method: metodo, cookies, header: (n: string) => minus[n.toLowerCase()] } as unknown as Request;
}

function correr(req: Request): unknown {
  const next = vi.fn();
  try {
    verificarCsrf(ORIGEN)(req, {} as Response, next);
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return next.mock.calls.length === 1 ? 'next' : 'sin-next';
}

describe('verificarCsrf', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('no exige nada en %s', (metodo) => {
    expect(correr(peticion(metodo, { Origin: 'https://otro.test' }))).toBe('next');
  });

  it('acepta token igual a la cookie con el Origin propio', () => {
    expect(correr(peticion('POST', { 'X-CSRF-Token': 'abc', Origin: ORIGEN }, { criterio_csrf: 'abc' }))).toBe('next');
    expect(correr(peticion('DELETE', { 'X-CSRF-Token': 'abc', Origin: ORIGEN }, { criterio_csrf: 'abc' }))).toBe('next');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('exige Origin en %s aunque el token sea correcto', (metodo) => {
    expect(correr(peticion(metodo, { 'X-CSRF-Token': 'abc' }, { criterio_csrf: 'abc' }))).toBe('CSRF_INVALIDO');
  });

  it('token no ASCII contra uno ASCII (largos en bytes distintos) → CSRF_INVALIDO, sin RangeError', () => {
    const ascii = 'a'.repeat(43);
    const noAscii = 'é'.repeat(43);
    expect(correr(peticion('POST', { 'X-CSRF-Token': noAscii, Origin: ORIGEN }, { criterio_csrf: ascii }))).toBe('CSRF_INVALIDO');
    expect(correr(peticion('POST', { 'X-CSRF-Token': ascii, Origin: ORIGEN }, { criterio_csrf: noAscii }))).toBe('CSRF_INVALIDO');
    expect(correr(peticion('POST', { 'X-CSRF-Token': noAscii, Origin: ORIGEN }, { criterio_csrf: noAscii }))).toBe('next');
  });

  it.each([
    ['sin cabecera', {}, { criterio_csrf: 'abc' }],
    ['sin cookie', { 'X-CSRF-Token': 'abc' }, {}],
    ['ambos vacíos', { 'X-CSRF-Token': '' }, { criterio_csrf: '' }],
    ['distinto largo', { 'X-CSRF-Token': 'abcd' }, { criterio_csrf: 'abc' }],
    ['mismo largo, distinto valor', { 'X-CSRF-Token': 'abd' }, { criterio_csrf: 'abc' }],
    ['Origin ajeno', { 'X-CSRF-Token': 'abc', Origin: 'https://otro.test' }, { criterio_csrf: 'abc' }],
    ['Origin null', { 'X-CSRF-Token': 'abc', Origin: 'null' }, { criterio_csrf: 'abc' }],
    ['cookie convertida en objeto (j:)', { 'X-CSRF-Token': '[object Object]' }, { criterio_csrf: { a: 1 } }],
    ['cookie no string', { 'X-CSRF-Token': '1' }, { criterio_csrf: 1 }],
  ])('rechaza con CSRF_INVALIDO: %s', (_caso, cabeceras, cookies) => {
    expect(correr(peticion('POST', { Origin: ORIGEN, ...cabeceras }, cookies))).toBe('CSRF_INVALIDO');
  });
});

describe('verificarOrigen (toda la app, también rutas PUBLICA)', () => {
  const origen = (metodo: string, cabeceras: Record<string, string> = {}): unknown => {
    const next = vi.fn();
    try {
      verificarOrigen(ORIGEN)(peticion(metodo, cabeceras), {} as Response, next);
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return next.mock.calls.length === 1 ? 'next' : 'sin-next';
  };

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rechaza un Origin ajeno o "null" en %s', (metodo) => {
    expect(origen(metodo, { Origin: 'https://otro.test' })).toBe('CSRF_INVALIDO');
    expect(origen(metodo, { Origin: 'null' })).toBe('CSRF_INVALIDO');
    expect(origen(metodo, { Origin: `${ORIGEN}/` })).toBe('CSRF_INVALIDO');
  });

  it('deja pasar el Origin propio y la ausencia de Origin (clientes que no son navegadores)', () => {
    expect(origen('POST', { Origin: ORIGEN })).toBe('next');
    expect(origen('POST')).toBe('next');
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('no revisa %s', (metodo) => {
    expect(origen(metodo, { Origin: 'https://otro.test' })).toBe('next');
  });
});
