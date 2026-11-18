import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { verificarCsrf } from '../../src/http/csrf';

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

  it('acepta token igual a la cookie, con o sin Origin propio', () => {
    expect(correr(peticion('POST', { 'X-CSRF-Token': 'abc' }, { criterio_csrf: 'abc' }))).toBe('next');
    expect(correr(peticion('DELETE', { 'X-CSRF-Token': 'abc', Origin: ORIGEN }, { criterio_csrf: 'abc' }))).toBe('next');
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
    expect(correr(peticion('POST', cabeceras, cookies))).toBe('CSRF_INVALIDO');
  });
});
