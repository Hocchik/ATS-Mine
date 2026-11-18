import { describe, expect, it } from 'vitest';
import { COOKIE_SESION } from '../../src/auth/cookies';
import { firmarSesion } from '../../src/auth/jwt';
import { crearResolverSesion } from '../../src/auth/resolver-sesion';
import type { PrismaTenant } from '../../src/tenant/extension';

const SECRETO = 'secreto-de-prueba-fijo-para-sesiones-0123456789';
const U = '11111111-1111-4111-8111-111111111111';
const ORG = '33333333-3333-4333-8333-333333333333';
const MID = '44444444-4444-4444-8444-444444444444';

interface Diferido<T> {
  promesa: Promise<T>;
  resolver: (v: T) => void;
}
function diferido<T>(): Diferido<T> {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => (resolver = r));
  return { promesa, resolver };
}

const filaMembresia = (version: number, rol: string) => ({
  version,
  rol,
  usuarioId: U,
  organizacionId: ORG,
  organizacion: { estadoVerificacion: 'VERIFICADA' },
});

/** Fake de prisma: cada lectura devuelve la siguiente promesa encolada. */
function fake() {
  const colaUsuario: Array<Promise<unknown>> = [];
  const colaMembresia: Array<Promise<unknown>> = [];
  const lecturas = { usuario: 0, membresia: 0 };
  const prisma = {
    usuario: {
      findUnique: () => {
        lecturas.usuario++;
        return colaUsuario.shift()!;
      },
    },
    membresia: {
      findUnique: () => {
        lecturas.membresia++;
        return colaMembresia.shift()!;
      },
    },
  } as unknown as PrismaTenant;
  return { prisma, colaUsuario, colaMembresia, lecturas };
}

async function peticion(contenido: Parameters<typeof firmarSesion>[0]) {
  const token = await firmarSesion(contenido, SECRETO);
  return { cookies: { [COOKIE_SESION]: token } } as never;
}

/** Espera (sin depender de tiempos fijos) a que el resolver llegue a la lectura pendiente. */
async function hasta(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(cond()).toBe(true);
}

describe('resolver de sesión: invalidación frente a lecturas en curso', () => {
  it('una lectura de membresía en vuelo no re-cachea la fila vieja tras invalidarMembresia', async () => {
    const { prisma, colaUsuario, colaMembresia, lecturas } = fake();
    const { resolver, invalidarMembresia } = crearResolverSesion({ prisma, secreto: SECRETO });
    const req = await peticion({
      usuarioId: U,
      versionSesion: 1,
      empresa: { organizacionId: ORG, membresiaId: MID, versionMembresia: 1 },
    });
    colaUsuario.push(Promise.resolve({ versionSesion: 1, esSuperadmin: false }), Promise.resolve({ versionSesion: 1, esSuperadmin: false }));
    const enVuelo = diferido<unknown>();
    colaMembresia.push(enVuelo.promesa);

    const p1 = resolver(req);
    await hasta(() => lecturas.membresia === 1);

    invalidarMembresia(MID);
    colaMembresia.push(Promise.resolve(filaMembresia(2, 'OWNER')));
    enVuelo.resolver(filaMembresia(1, 'OWNER'));
    await p1;

    expect(await resolver(req)).toEqual({ usuarioId: U, esSuperadmin: false });
    expect(lecturas.membresia).toBe(2);
  });

  it('una lectura de usuario en vuelo no re-cachea la fila vieja tras invalidarUsuario', async () => {
    const { prisma, colaUsuario, lecturas } = fake();
    const { resolver, invalidarUsuario } = crearResolverSesion({ prisma, secreto: SECRETO });
    const req = await peticion({ usuarioId: U, versionSesion: 1 });
    const enVuelo = diferido<unknown>();
    colaUsuario.push(enVuelo.promesa);

    const p1 = resolver(req);
    await hasta(() => lecturas.usuario === 1);

    invalidarUsuario(U);
    colaUsuario.push(Promise.resolve({ versionSesion: 2, esSuperadmin: false }));
    enVuelo.resolver({ versionSesion: 1, esSuperadmin: false });
    await p1;

    expect(await resolver(req)).toBeNull();
    expect(lecturas.usuario).toBe(2);
  });

  it('sin invalidación, la lectura sí se cachea (no hay segunda lectura)', async () => {
    const { prisma, colaUsuario, lecturas } = fake();
    const { resolver } = crearResolverSesion({ prisma, secreto: SECRETO });
    const req = await peticion({ usuarioId: U, versionSesion: 1 });
    colaUsuario.push(Promise.resolve({ versionSesion: 1, esSuperadmin: false }));
    await resolver(req);
    await resolver(req);
    expect(lecturas.usuario).toBe(1);
  });
});
