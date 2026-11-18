import { beforeEach, describe, expect, it } from 'vitest';
import { sembrarSuperadmin } from '../../prisma/sembrar-superadmin';
import { verificarContrasena } from '../../src/auth/contrasenas';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearUsuario } from '../fabricas';

beforeEach(limpiarBase);

const prisma = extenderConTenant(prismaPrueba);
const EMAIL = 'superadmin@ejemplo.test';
const CONTRASENA = 'contrasena-del-seed-larga';
const sembrar = (env: Record<string, string | undefined>) => sembrarSuperadmin(prisma, env, { costo: 4 });

const conHash = (email: string) =>
  prismaPrueba.usuario.findUnique({ where: { email }, omit: { passwordHash: false } });

describe('seed del superadmin', () => {
  it('sin las variables no hace nada y lo dice', async () => {
    const resultado = await sembrar({});

    expect(resultado.estado).toBe('SIN_VARIABLES');
    expect(resultado.mensaje).toMatch(/SEED_SUPERADMIN_EMAIL/);
    expect(await prismaPrueba.usuario.count()).toBe(0);
  });

  it('crea al superadmin con el email normalizado y la contraseña hasheada', async () => {
    const resultado = await sembrar({ SEED_SUPERADMIN_EMAIL: '  SuperAdmin@Ejemplo.test ', SEED_SUPERADMIN_PASSWORD: CONTRASENA });

    expect(resultado.estado).toBe('CREADO');
    const usuario = await conHash(EMAIL);
    expect(usuario?.esSuperadmin).toBe(true);
    expect(usuario?.passwordHash).not.toBe(CONTRASENA);
    expect(await verificarContrasena(CONTRASENA, usuario?.passwordHash ?? null)).toBe(true);
  });

  it('si ya existe, lo vuelve superadmin, cambia el hash y sube versionSesion', async () => {
    const base = await crearUsuario();
    const existente = await prismaPrueba.usuario.update({ where: { id: base.id }, data: { email: EMAIL } });

    const resultado = await sembrar({ SEED_SUPERADMIN_EMAIL: EMAIL, SEED_SUPERADMIN_PASSWORD: CONTRASENA });

    expect(resultado.estado).toBe('ACTUALIZADO');
    const usuario = await conHash(EMAIL);
    expect(usuario?.id).toBe(existente.id);
    expect(usuario?.esSuperadmin).toBe(true);
    expect(usuario?.versionSesion).toBe(existente.versionSesion + 1);
    expect(await verificarContrasena(CONTRASENA, usuario?.passwordHash ?? null)).toBe(true);
    expect(await prismaPrueba.usuario.count()).toBe(1);
  });

  it('valores inválidos o una sola variable → error claro, sin repetir los valores y sin cambios', async () => {
    const casos = [
      { SEED_SUPERADMIN_EMAIL: 'no-es-email', SEED_SUPERADMIN_PASSWORD: CONTRASENA },
      { SEED_SUPERADMIN_EMAIL: EMAIL, SEED_SUPERADMIN_PASSWORD: 'corta' },
      { SEED_SUPERADMIN_EMAIL: EMAIL },
    ];
    for (const env of casos) {
      const error = await sembrar(env).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      const mensaje = (error as Error).message;
      expect(mensaje).toMatch(/SEED_SUPERADMIN_/);
      expect(mensaje).not.toContain('corta');
      expect(mensaje).not.toContain('no-es-email');
    }
    expect(await prismaPrueba.usuario.count()).toBe(0);
  });
});
