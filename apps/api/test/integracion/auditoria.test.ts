import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditar } from '../../src/auditoria';
import { extenderConTenant, type PrismaTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearOrganizacion, crearUsuario } from '../fabricas';

const prisma = extenderConTenant(prismaPrueba);

beforeEach(limpiarBase);

describe('auditar', () => {
  it('escribe la fila con sus campos', async () => {
    const org = await crearOrganizacion({ nombre: 'A' });
    const usuario = await crearUsuario();
    await auditar(prisma, {
      tipo: 'CAMBIO_ROL',
      usuarioId: usuario.id,
      organizacionAfectadaId: org.id,
      ip: '203.0.113.7',
      datos: { rolNuevo: 'ADMIN', intento: 2, ok: true },
    });
    const filas = await prismaPrueba.eventoAuditoria.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tipo: 'CAMBIO_ROL',
      usuarioId: usuario.id,
      organizacionAfectadaId: org.id,
      ip: '203.0.113.7',
      datos: { rolNuevo: 'ADMIN', intento: 2, ok: true },
    });
  });

  it('trunca valores de texto largos', async () => {
    await auditar(prisma, { tipo: 'LOGIN', datos: { nota: 'x'.repeat(500) } });
    const fila = await prismaPrueba.eventoAuditoria.findFirstOrThrow();
    expect((fila.datos as { nota: string }).nota).toHaveLength(200);
  });

  it.each(['email', 'Telefono', 'documento', 'nombre', 'contrasena', 'password', 'token', 'tokenHash', 'passwordHash'])(
    'rechaza la clave de datos personales %s',
    async (clave) => {
      await expect(auditar(prisma, { tipo: 'LOGIN', datos: { [clave]: 'x' } })).rejects.toThrow(/datos personales/);
      expect(await prismaPrueba.eventoAuditoria.count()).toBe(0);
    },
  );

  it('si la base falla, no lanza y registra el error', async () => {
    const falso = {
      eventoAuditoria: { create: vi.fn().mockRejectedValue(new Error('base caída')) },
    } as unknown as PrismaTenant;
    const logger = { error: vi.fn() };
    await expect(auditar(falso, { tipo: 'LOGIN' }, logger)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
