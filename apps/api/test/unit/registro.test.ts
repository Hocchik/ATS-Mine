import { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { crearRegistro, type Acceso } from '../../src/http/registro';
import { resolverPrueba } from '../sesion-prueba';

describe('crearRegistro', () => {
  it('falla cerrado ante un acceso que no conoce (no monta la ruta como pública)', () => {
    const registro = crearRegistro(resolverPrueba);
    const router = Router();
    expect(() =>
      registro.definir(router, { metodo: 'get', ruta: '/api/nueva', acceso: 'INTERNA' as unknown as Acceso }, () => {}),
    ).toThrow(/acceso/i);
    expect(registro.definiciones).toEqual([]);
  });

  it('exige escenario de aislamiento a las rutas TENANT', () => {
    const registro = crearRegistro(resolverPrueba);
    expect(() => registro.definir(Router(), { metodo: 'get', ruta: '/api/x', acceso: 'TENANT' }, () => {})).toThrow(
      /escenario de aislamiento/,
    );
  });
});
