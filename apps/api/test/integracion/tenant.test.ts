import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComoPlataforma, ejecutarEnTenant } from '../../src/tenant/contexto';
import { extenderConTenant, SinContextoTenantError } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

const prisma = extenderConTenant(prismaPrueba);

async function escenario() {
  const orgA = await crearOrganizacion({ nombre: 'A' });
  const orgB = await crearOrganizacion({ nombre: 'B' });
  const usuario = await crearUsuario();
  const membresiaA = await crearMembresia(usuario.id, orgA.id);
  const membresiaB = await crearMembresia(usuario.id, orgB.id);
  return { orgA, orgB, usuario, membresiaA, membresiaB };
}

beforeEach(limpiarBase);

describe('extensión multiempresa', () => {
  it('rechaza consultas a modelos multiempresa sin contexto', async () => {
    await expect(prisma.membresia.findMany()).rejects.toBeInstanceOf(SinContextoTenantError);
  });

  it('findMany solo devuelve filas de la empresa activa', async () => {
    const { orgA, membresiaA } = await escenario();
    const filas = await ejecutarEnTenant(orgA.id, () => prisma.membresia.findMany());
    expect(filas.map((f) => f.id)).toEqual([membresiaA.id]);
  });

  it('findUnique por id de otra empresa devuelve null', async () => {
    const { orgA, membresiaB } = await escenario();
    const fila = await ejecutarEnTenant(orgA.id, () =>
      prisma.membresia.findUnique({ where: { id: membresiaB.id } }),
    );
    expect(fila).toBeNull();
  });

  it('update sobre una fila de otra empresa falla y no la modifica', async () => {
    const { orgA, membresiaB } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.update({ where: { id: membresiaB.id }, data: { rol: 'ENTREVISTADOR' } }),
      ),
    ).rejects.toThrow();
    const sinCambios = await prismaPrueba.membresia.findUniqueOrThrow({ where: { id: membresiaB.id } });
    expect(sinCambios.rol).toBe('OWNER');
  });

  it('deleteMany no toca otras empresas', async () => {
    const { orgA, membresiaB } = await escenario();
    await ejecutarEnTenant(orgA.id, () => prisma.membresia.deleteMany({}));
    expect(await prismaPrueba.membresia.findUnique({ where: { id: membresiaB.id } })).not.toBeNull();
  });

  it('count respeta la empresa activa', async () => {
    const { orgB } = await escenario();
    expect(await ejecutarEnTenant(orgB.id, () => prisma.membresia.count())).toBe(1);
  });

  it('create rechaza un organizacionId distinto al del contexto', async () => {
    const { orgA, orgB } = await escenario();
    const otro = await crearUsuario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.create({ data: { usuarioId: otro.id, organizacionId: orgB.id, rol: 'RECLUTADOR' } }),
      ),
    ).rejects.toThrow(/no coincide/);
  });

  it('create con el organizacionId del contexto funciona', async () => {
    const { orgA } = await escenario();
    const otro = await crearUsuario();
    const creada = await ejecutarEnTenant(orgA.id, () =>
      prisma.membresia.create({ data: { usuarioId: otro.id, organizacionId: orgA.id, rol: 'RECLUTADOR' } }),
    );
    expect(creada.organizacionId).toBe(orgA.id);
  });

  it('update no puede cambiar organizacionId', async () => {
    const { orgA, orgB, membresiaA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.update({ where: { id: membresiaA.id }, data: { organizacionId: orgB.id } }),
      ),
    ).rejects.toThrow(/organizacionId/);
  });

  it('el modo plataforma ve todas las empresas', async () => {
    await escenario();
    const total = await ejecutarComoPlataforma('prueba', () => prisma.membresia.count());
    expect(total).toBe(2);
  });

  it('Organizacion (global) se lee sin contexto; Usuario no', async () => {
    await escenario();
    expect(await prisma.organizacion.count()).toBe(2);
    await expect(prisma.usuario.count()).rejects.toBeInstanceOf(SinContextoTenantError);
  });
});
