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
    const def: DefinicionRuta = { metodo: 'get', ruta: '/api/x', acceso, roles: ['OWNER'], aislamiento: { noAplica: 'x' } };
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
    const def: DefinicionRuta = { metodo: 'get', ruta: '/api/x', acceso, aislamiento: { noAplica: 'x' } };
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

  describe('rutas duplicadas o sombreadas', () => {
    const publica = (ruta: string, metodo: DefinicionRuta['metodo'] = 'get'): DefinicionRuta => ({ metodo, ruta, acceso: 'PUBLICA' });

    it.each([
      ['solo cambia mayúsculas', '/api/p/Dup', '/api/p/dup'],
      ['barra final', '/api/p/dup', '/api/p/dup/'],
      ['nombre del parámetro', '/api/vacantes/:id', '/api/vacantes/:vacanteId'],
      ['mayúsculas, barra y parámetro', '/api/Vacantes/:id/', '/api/vacantes/:otro'],
    ])('lanza al registrar la misma ruta dos veces (%s)', (_caso, primera, segunda) => {
      const registro = nuevoRegistro();
      const router = Router();
      registro.definir(router, publica(primera), () => {});
      expect(() =>
        registro.definir(router, { metodo: 'get', ruta: segunda, acceso: 'TENANT', aislamiento: escenario }, () => {}),
      ).toThrow(/duplicada/);
      expect(registro.definiciones).toHaveLength(1);
      expect(router.stack).toHaveLength(1);
    });

    it('la misma ruta con otro método no es duplicada; la raíz conserva su barra', () => {
      const registro = nuevoRegistro();
      registro.definir(Router(), publica('/api/x'), () => {});
      registro.definir(Router(), publica('/api/x', 'post'), () => {});
      registro.definir(Router(), publica('/'), () => {});
      registro.definir(Router(), publica('/api/x/:id'), () => {});
      expect(registro.definiciones).toHaveLength(4);
    });
  });

  it.each<[Acceso, string]>([
    ['TENANT', '/public/p/tenant'],
    ['AUTENTICADA', '/vacantes'],
    ['PLATAFORMA', '/admin/organizaciones'],
    ['TENANT', '/apix/vacantes'],
    ['AUTENTICADA', '/api'],
  ])('una ruta %s fuera de /api/ lanza (%s)', (acceso, ruta) => {
    const registro = nuevoRegistro();
    const def: DefinicionRuta =
      acceso === 'PLATAFORMA' ? { metodo: 'post', ruta, acceso } : { metodo: 'post', ruta, acceso, aislamiento: escenario };
    expect(() => registro.definir(Router(), def, () => {})).toThrow(/\/api\//);
    expect(registro.definiciones).toEqual([]);
  });

  it('una ruta PUBLICA puede vivir en /api/ o fuera de ella', () => {
    const registro = nuevoRegistro();
    registro.definir(Router(), { metodo: 'post', ruta: '/api/auth/login', acceso: 'PUBLICA' }, () => {});
    registro.definir(Router(), { metodo: 'post', ruta: '/public/postular/:slug', acceso: 'PUBLICA' }, () => {});
    expect(registro.definiciones).toHaveLength(2);
  });

  it.each<[string, unknown]>([
    ['objeto vacío', {}],
    ['preparar que no es función', { preparar: 'no' }],
  ])('TENANT y AUTENTICADA rechazan un escenario sin preparar (%s)', (_caso, aislamiento) => {
    for (const acceso of ['TENANT', 'AUTENTICADA'] as const) {
      const registro = nuevoRegistro();
      const def = { metodo: 'get', ruta: '/api/x', acceso, aislamiento } as unknown as DefinicionRuta;
      expect(() => registro.definir(Router(), def, () => {})).toThrow(/preparar/);
      expect(registro.definiciones).toEqual([]);
    }
  });

  it.each<[string, unknown]>([
    ['número', 123],
    ['null', null],
    ['vacío', ''],
  ])('noAplica tiene que ser un motivo de texto (%s)', (_caso, noAplica) => {
    const registro = nuevoRegistro();
    const def = { metodo: 'get', ruta: '/api/yo', acceso: 'AUTENTICADA', aislamiento: { noAplica } } as unknown as DefinicionRuta;
    expect(() => registro.definir(Router(), def, () => {})).toThrow(/motivo/);
    expect(registro.definiciones).toEqual([]);
  });
});
