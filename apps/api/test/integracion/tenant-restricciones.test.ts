import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarEnTenant } from '../../src/tenant/contexto';
import { extenderConTenant } from '../../src/tenant/extension';
import { ViolacionMultiempresaError } from '../../src/tenant/relaciones';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

const prisma = extenderConTenant(prismaPrueba);

async function escenario() {
  const orgA = await crearOrganizacion({ nombre: 'A' });
  const orgB = await crearOrganizacion({ nombre: 'B' });
  const usuarioA = await crearUsuario();
  const usuarioB = await crearUsuario();
  await crearMembresia(usuarioA.id, orgA.id);
  await crearMembresia(usuarioB.id, orgB.id);
  return { orgA, orgB, usuarioA, usuarioB };
}

beforeEach(limpiarBase);

describe('un organizacionId ajeno en el where no redirige la consulta a la empresa propia', () => {
  it('deleteMany con organizacionId de otra empresa no borra nada', async () => {
    const { orgA, orgB } = await escenario();
    const r = await ejecutarEnTenant(orgA.id, () =>
      prisma.membresia.deleteMany({ where: { organizacionId: orgB.id } }),
    );
    expect(r.count).toBe(0);
    expect(await prismaPrueba.membresia.count()).toBe(2);
  });

  it('findMany con organizacionId de otra empresa devuelve vacío', async () => {
    const { orgA, orgB } = await escenario();
    expect(
      await ejecutarEnTenant(orgA.id, () => prisma.membresia.findMany({ where: { organizacionId: orgB.id } })),
    ).toEqual([]);
  });

  it('count con organizacionId distinto de la propia devuelve 0', async () => {
    const { orgA } = await escenario();
    expect(
      await ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.count({ where: { organizacionId: { not: orgA.id } } }),
      ),
    ).toBe(0);
  });
});

describe('Organizacion: solo se editan campos permitidos', () => {
  it('no puede cambiar su propio id', async () => {
    const { orgA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.organizacion.update({
          where: { id: orgA.id },
          data: { id: '00000000-0000-4000-8000-000000000000' },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('update sobre otra empresa falla con P2025', async () => {
    const { orgA, orgB } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.organizacion.update({ where: { id: orgB.id }, data: { nombre: 'X' } })),
    ).rejects.toMatchObject({ code: 'P2025' });
  });
});

describe('Usuario en contexto de empresa', () => {
  it('solo ve usuarios con membresía en la empresa activa', async () => {
    const { orgA, usuarioA } = await escenario();
    const usuarios = await ejecutarEnTenant(orgA.id, () => prisma.usuario.findMany());
    expect(usuarios.map((u) => u.id)).toEqual([usuarioA.id]);
  });

  it('no devuelve passwordHash', async () => {
    const { orgA } = await escenario();
    const [usuario] = await ejecutarEnTenant(orgA.id, () => prisma.usuario.findMany());
    expect(usuario).toBeDefined();
    expect(usuario).not.toHaveProperty('passwordHash');
  });

  it('rechaza seleccionar passwordHash', async () => {
    const { orgA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.usuario.findMany({ select: { id: true, passwordHash: true } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('findUnique de un usuario de otra empresa devuelve null', async () => {
    const { orgA, usuarioB } = await escenario();
    expect(
      await ejecutarEnTenant(orgA.id, () => prisma.usuario.findUnique({ where: { id: usuarioB.id } })),
    ).toBeNull();
  });
});
