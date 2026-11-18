import { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { crearRegistro, type Acceso, type DefinicionRuta } from '../../src/http/registro';
import { resolverPrueba } from '../sesion-prueba';
import { ORIGEN_PRUEBA } from '../sesion-real';

const nuevoRegistro = () => crearRegistro({ resolverSesion: resolverPrueba, webOrigin: ORIGEN_PRUEBA });
const escenario: NonNullable<DefinicionRuta['aislamiento']> = {
  preparar: async () => ({ tipo: 'COLECCION', ruta: '/api/x', marcador: 'm' }),
};

describe('crearRegistro', () => {
  it('falla cerrado ante un acceso que no conoce (no monta la ruta como pública)', () => {
    const registro = nuevoRegistro();
    const router = Router();
    expect(() =>
      registro.definir(router, { metodo: 'get', ruta: '/api/nueva', acceso: 'INTERNA' as unknown as Acceso }, () => {}),
    ).toThrow(/acceso/i);
    expect(registro.definiciones).toEqual([]);
  });

  it('exige escenario de aislamiento a las rutas TENANT', () => {
    const registro = nuevoRegistro();
    expect(() => registro.definir(Router(), { metodo: 'get', ruta: '/api/x', acceso: 'TENANT' }, () => {})).toThrow(
      /escenario de aislamiento/,
    );
  });

  it('una ruta TENANT no puede declararse noAplica', () => {
    const registro = nuevoRegistro();
    const def: DefinicionRuta = { metodo: 'get', ruta: '/api/x', acceso: 'TENANT', aislamiento: { noAplica: 'porque sí' } };
    expect(() => registro.definir(Router(), def, () => {})).toThrow(/escenario de aislamiento/);
  });

  it('exige aislamiento (escenario o noAplica) a las rutas AUTENTICADA', () => {
    const registro = nuevoRegistro();
    expect(() => registro.definir(Router(), { metodo: 'get', ruta: '/api/yo', acceso: 'AUTENTICADA' }, () => {})).toThrow(
      /aislamiento/,
    );
    expect(registro.definiciones).toEqual([]);
    registro.definir(Router(), { metodo: 'get', ruta: '/api/yo', acceso: 'AUTENTICADA', aislamiento: { noAplica: 'propia' } }, () => {});
    registro.definir(Router(), { metodo: 'get', ruta: '/api/x', acceso: 'AUTENTICADA', aislamiento: escenario }, () => {});
    expect(registro.definiciones).toHaveLength(2);
  });

  it('rechaza noAplica sin motivo', () => {
    const registro = nuevoRegistro();
    const def: DefinicionRuta = { metodo: 'get', ruta: '/api/yo', acceso: 'AUTENTICADA', aislamiento: { noAplica: '  ' } };
    expect(() => registro.definir(Router(), def, () => {})).toThrow(/motivo/);
  });

  it.each<Acceso>(['PUBLICA', 'AUTENTICADA', 'PLATAFORMA'])('rechaza roles en una ruta %s', (acceso) => {
    const registro = nuevoRegistro();
    const def: DefinicionRuta = { metodo: 'get', ruta: '/x', acceso, roles: ['OWNER'], aislamiento: { noAplica: 'x' } };
    expect(() => registro.definir(Router(), def, () => {})).toThrow(/roles/);
    expect(registro.definiciones).toEqual([]);
  });

  it('rechaza una lista de roles vacía en una ruta TENANT', () => {
    const registro = nuevoRegistro();
    const def: DefinicionRuta = { metodo: 'get', ruta: '/api/x', acceso: 'TENANT', roles: [], aislamiento: escenario };
    expect(() => registro.definir(Router(), def, () => {})).toThrow(/roles/);
  });

  it.each<Acceso>(['PUBLICA', 'PLATAFORMA'])('rechaza aislamiento declarado en una ruta %s', (acceso) => {
    const registro = nuevoRegistro();
    const def: DefinicionRuta = { metodo: 'get', ruta: '/x', acceso, aislamiento: { noAplica: 'x' } };
    expect(() => registro.definir(Router(), def, () => {})).toThrow(/aislamiento/);
  });

  it('guarda cada definición', () => {
    const registro = nuevoRegistro();
    registro.definir(Router(), { metodo: 'get', ruta: '/x', acceso: 'PUBLICA' }, () => undefined);
    registro.definir(Router(), { metodo: 'get', ruta: '/api/admin', acceso: 'PLATAFORMA' }, () => undefined);
    registro.definir(Router(), { metodo: 'get', ruta: '/api/x', acceso: 'TENANT', roles: ['OWNER'], aislamiento: escenario }, () => undefined);
    expect(registro.definiciones.map((d) => `${d.acceso} ${d.ruta}`)).toEqual([
      'PUBLICA /x',
      'PLATAFORMA /api/admin',
      'TENANT /api/x',
    ]);
  });
});
