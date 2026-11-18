import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

beforeEach(limpiarBase);

describe('schema base', () => {
  it('crea una organización con valores por defecto pendiente de verificación', async () => {
    const org = await crearOrganizacion();
    expect(org.estadoVerificacion).toBe('PENDIENTE');
    expect(org.esDemo).toBe(false);
    expect(org.googleJobsHabilitado).toBe(false);
  });

  it('impide dos membresías del mismo usuario en la misma empresa', async () => {
    const org = await crearOrganizacion();
    const usuario = await crearUsuario();
    await crearMembresia(usuario.id, org.id);
    await expect(crearMembresia(usuario.id, org.id)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('limpiarBase deja las tablas vacías', async () => {
    await crearOrganizacion();
    await limpiarBase();
    expect(await prismaPrueba.organizacion.count()).toBe(0);
  });
});
