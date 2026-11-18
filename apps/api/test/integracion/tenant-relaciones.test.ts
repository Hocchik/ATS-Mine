import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComoPlataforma, ejecutarEnTenant } from '../../src/tenant/contexto';
import { extenderConTenant, SinContextoTenantError } from '../../src/tenant/extension';
import { MODELOS_TENANT, ViolacionMultiempresaError } from '../../src/tenant/relaciones';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

const prisma = extenderConTenant(prismaPrueba);

async function escenario() {
  const orgA = await crearOrganizacion({ nombre: 'A' });
  const orgB = await crearOrganizacion({ nombre: 'B' });
  const usuario = await crearUsuario();
  const membresiaA = await crearMembresia(usuario.id, orgA.id, 'RECLUTADOR');
  const membresiaB = await crearMembresia(usuario.id, orgB.id, 'RECLUTADOR');
  return { orgA, orgB, usuario, membresiaA, membresiaB };
}

beforeEach(limpiarBase);

describe('MODELOS_TENANT (derivado del schema)', () => {
  it('incluye los modelos con organizacionId y excluye los globales', () => {
    expect(MODELOS_TENANT.has('Membresia')).toBe(true);
    expect(MODELOS_TENANT.has('Usuario')).toBe(false);
    expect(MODELOS_TENANT.has('Organizacion')).toBe(false);
  });

  it('todo modelo multiempresa tiene @@unique([id, organizacionId])', () => {
    for (const modelo of Prisma.dmmf.datamodel.models.filter((m) => MODELOS_TENANT.has(m.name))) {
      const tieneCompuesta = modelo.uniqueFields.some(
        (campos) => campos.length === 2 && campos.includes('id') && campos.includes('organizacionId'),
      );
      expect(tieneCompuesta, `${modelo.name} sin @@unique([id, organizacionId])`).toBe(true);
    }
  });
});

describe('escrituras anidadas', () => {
  it('update no puede mover la fila a otra empresa con organizacion.connect', async () => {
    const { orgA, orgB, membresiaA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.update({
          where: { id: membresiaA.id },
          data: { rol: 'OWNER', organizacion: { connect: { id: orgB.id } } },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    const sinCambios = await prismaPrueba.membresia.findUniqueOrThrow({ where: { id: membresiaA.id } });
    expect(sinCambios.organizacionId).toBe(orgA.id);
    expect(sinCambios.rol).toBe('RECLUTADOR');
  });

  it('update no puede editar la organización por la relación', async () => {
    const { orgA, membresiaA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.update({
          where: { id: membresiaA.id },
          data: { organizacion: { update: { estadoVerificacion: 'VERIFICADA' } } },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('upsert no puede mover la fila por update.organizacion', async () => {
    const { orgA, orgB, membresiaA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.upsert({
          where: { id: membresiaA.id },
          create: { usuarioId: membresiaA.usuarioId, organizacionId: orgA.id, rol: 'RECLUTADOR' },
          update: { organizacion: { connect: { id: orgB.id } } },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('un modelo global no puede crear filas multiempresa anidadas', async () => {
    const { orgA, orgB } = await escenario();
    const otra = await crearUsuario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.organizacion.update({
          where: { id: orgB.id },
          data: { membresias: { create: { usuarioId: otra.id, rol: 'OWNER' } } },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    expect(await prismaPrueba.membresia.count({ where: { usuarioId: otra.id } })).toBe(0);
  });

  it('un modelo global no puede borrar filas multiempresa anidadas', async () => {
    const { orgA, usuario } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.usuario.update({ where: { id: usuario.id }, data: { membresias: { deleteMany: {} } } }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    expect(await prismaPrueba.membresia.count()).toBe(2);
  });
});

describe('lecturas que cruzan de global a multiempresa', () => {
  it('include desde un modelo global se rechaza', async () => {
    const { orgA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.usuario.findMany({ include: { membresias: true } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('la ruta tenant → global → tenant se rechaza', async () => {
    const { orgA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.findMany({ include: { usuario: { include: { membresias: true } } } }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('_count de relaciones multiempresa desde un modelo global se rechaza', async () => {
    const { orgA, orgB } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.organizacion.findUnique({
          where: { id: orgB.id },
          select: { _count: { select: { membresias: true } } },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('_count: true sobre un modelo global con relaciones multiempresa se rechaza', async () => {
    const { orgA, orgB } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.organizacion.findUnique({ where: { id: orgB.id }, select: { _count: true } }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('un filtro de relación global → multiempresa se rechaza', async () => {
    const { orgA, orgB } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.findMany({
          where: { usuario: { membresias: { some: { organizacionId: orgB.id } } } },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('orderBy por una relación multiempresa desde un modelo global se rechaza', async () => {
    const { orgA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.usuario.findMany({ orderBy: { membresias: { _count: 'desc' } } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('tenant → global sin volver está permitido', async () => {
    const { orgA, usuario } = await escenario();
    const filas = await ejecutarEnTenant(orgA.id, () => prisma.membresia.findMany({ include: { usuario: true } }));
    expect(filas).toHaveLength(1);
    expect(filas[0]?.usuario.id).toBe(usuario.id);
  });

  it('un modelo global sin relaciones multiempresa funciona en contexto de empresa', async () => {
    const { orgA } = await escenario();
    expect(await ejecutarEnTenant(orgA.id, () => prisma.usuario.count())).toBe(1);
  });

  it('sin contexto, cruzar a un modelo multiempresa lanza SinContextoTenantError', async () => {
    await escenario();
    await expect(prisma.usuario.findMany({ include: { membresias: true } })).rejects.toBeInstanceOf(
      SinContextoTenantError,
    );
  });

  it('el modo plataforma puede cruzar relaciones', async () => {
    await escenario();
    const usuarios = await ejecutarComoPlataforma('prueba', () =>
      prisma.usuario.findMany({ include: { membresias: true } }),
    );
    expect(usuarios[0]?.membresias).toHaveLength(2);
  });
});

describe('create con organizacionId ajeno', () => {
  it('lanza ViolacionMultiempresaError', async () => {
    const { orgA, orgB } = await escenario();
    const otra = await crearUsuario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.membresia.create({ data: { usuarioId: otra.id, organizacionId: orgB.id, rol: 'RECLUTADOR' } }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });
});

describe('premisa de FKs compuestas', () => {
  it('toda relación con FK entre modelos multiempresa incluye organizacionId en la misma posición', () => {
    const modelos = Prisma.dmmf.datamodel.models;
    for (const modelo of modelos.filter((m) => MODELOS_TENANT.has(m.name))) {
      for (const campo of modelo.fields) {
        if (campo.kind !== 'object' || !MODELOS_TENANT.has(campo.type)) continue;
        const desde = campo.relationFromFields ?? [];
        if (desde.length === 0) continue;
        const hacia = campo.relationToFields ?? [];
        const i = desde.indexOf('organizacionId');
        expect(i, `${modelo.name}.${campo.name} debe usar FK compuesta con organizacionId`).toBeGreaterThanOrEqual(0);
        expect(hacia[i], `${modelo.name}.${campo.name}: organizacionId debe apuntar a organizacionId`).toBe('organizacionId');
      }
    }
  });
});

describe('valores inofensivos no disparan la guardia', () => {
  it('where con relación undefined', async () => {
    const { orgA } = await escenario();
    expect(
      await ejecutarEnTenant(orgA.id, () => prisma.usuario.count({ where: { membresias: undefined } })),
    ).toBe(1);
  });

  it('select con relación en false', async () => {
    const { orgA } = await escenario();
    const filas = await ejecutarEnTenant(orgA.id, () =>
      prisma.usuario.findMany({ select: { id: true, membresias: false } }),
    );
    expect(filas).toHaveLength(1);
  });
});
