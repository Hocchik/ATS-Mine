import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComoPlataforma, ejecutarEnTenant } from '../../src/tenant/contexto';
import { extenderConTenant, SinContextoTenantError } from '../../src/tenant/extension';
import { MODELOS_TENANT, ViolacionMultiempresaError } from '../../src/tenant/relaciones';
import { limpiarBase, prismaPrueba } from '../db';
import { crearInvitacion, crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

const prisma = extenderConTenant(prismaPrueba);

async function escenario() {
  const orgA = await crearOrganizacion({ nombre: 'A' });
  const orgB = await crearOrganizacion({ nombre: 'B' });
  const usuario = await crearUsuario();
  await crearMembresia(usuario.id, orgA.id);
  await crearMembresia(usuario.id, orgB.id);
  return { orgA, orgB, usuario };
}

beforeEach(limpiarBase);

describe('Organizacion en contexto de empresa', () => {
  it('update sobre otra empresa no la modifica', async () => {
    const { orgA, orgB } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.organizacion.update({ where: { id: orgB.id }, data: { nombre: 'X' } })),
    ).rejects.toThrow();
    expect((await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: orgB.id } })).nombre).toBe('B');
  });

  it('findUnique de otra empresa devuelve null y findMany solo la propia', async () => {
    const { orgA, orgB } = await escenario();
    expect(await ejecutarEnTenant(orgA.id, () => prisma.organizacion.findUnique({ where: { id: orgB.id } }))).toBeNull();
    const todas = await ejecutarEnTenant(orgA.id, () => prisma.organizacion.findMany());
    expect(todas.map((o) => o.id)).toEqual([orgA.id]);
  });

  it('puede actualizar sus propios campos editables', async () => {
    const { orgA } = await escenario();
    const actualizada = await ejecutarEnTenant(orgA.id, () =>
      prisma.organizacion.update({ where: { id: orgA.id }, data: { nombre: 'A renombrada' } }),
    );
    expect(actualizada.nombre).toBe('A renombrada');
  });

  it.each(['estadoVerificacion', 'verificadaEn', 'dominioCorreoVerificado', 'esDemo'] as const)(
    'no puede escribir el campo de plataforma %s',
    async (campo) => {
      const { orgA } = await escenario();
      const valores = {
        estadoVerificacion: 'VERIFICADA',
        verificadaEn: new Date(),
        dominioCorreoVerificado: true,
        esDemo: true,
      } as const;
      await expect(
        ejecutarEnTenant(orgA.id, () =>
          prisma.organizacion.update({ where: { id: orgA.id }, data: { [campo]: valores[campo] } }),
        ),
      ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    },
  );

  it('no puede borrar organizaciones', async () => {
    const { orgA, orgB } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.organizacion.delete({ where: { id: orgB.id } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    expect(await prismaPrueba.membresia.count({ where: { organizacionId: orgB.id } })).toBe(1);
  });

  it('no puede crear organizaciones', async () => {
    const { orgA } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.organizacion.create({ data: { nombre: 'Nueva', slug: 'nueva-x1' } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });
});

describe('Organizacion sin contexto', () => {
  it('permite leer (página pública por slug)', async () => {
    const { orgB } = await escenario();
    const org = await prisma.organizacion.findUnique({ where: { slug: orgB.slug } });
    expect(org?.id).toBe(orgB.id);
  });

  it('rechaza escribir', async () => {
    const { orgB } = await escenario();
    await expect(
      prisma.organizacion.update({ where: { id: orgB.id }, data: { nombre: 'X' } }),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });
});

describe('Usuario fuera del modo plataforma', () => {
  it('permite leer en contexto de empresa', async () => {
    const { orgA } = await escenario();
    expect(await ejecutarEnTenant(orgA.id, () => prisma.usuario.count())).toBe(1);
  });

  // Regla cambiada en la Tarea 14: antes, sin contexto se leían los usuarios de todas las empresas.
  it.each([
    ['count', () => prisma.usuario.count()],
    ['findMany', () => prisma.usuario.findMany()],
    ['findFirst', () => prisma.usuario.findFirst()],
    ['aggregate', () => prisma.usuario.aggregate({ _count: true })],
  ])('sin contexto, %s lanza SinContextoTenantError', async (_op, consulta) => {
    await escenario();
    await expect(consulta()).rejects.toBeInstanceOf(SinContextoTenantError);
  });

  it('rechaza escribir en contexto de empresa', async () => {
    const { orgA, usuario } = await escenario();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.usuario.update({ where: { id: usuario.id }, data: { esSuperadmin: true } }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    await expect(
      ejecutarEnTenant(orgA.id, () => prisma.usuario.delete({ where: { id: usuario.id } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    expect((await prismaPrueba.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).esSuperadmin).toBe(false);
  });

  it('rechaza escribir sin contexto (SinContextoTenantError: sin contexto, Usuario no admite ninguna operación)', async () => {
    await expect(
      prisma.usuario.update({ where: { email: 'x@ejemplo.test' }, data: { nombre: 'X' } }),
    ).rejects.toBeInstanceOf(SinContextoTenantError);
    expect(await prismaPrueba.usuario.count()).toBe(0);
  });
});

describe('modo plataforma', () => {
  it('puede escribir modelos globales', async () => {
    const { orgB } = await escenario();
    const org = await ejecutarComoPlataforma('verificación de prueba', () =>
      prisma.organizacion.update({ where: { id: orgB.id }, data: { estadoVerificacion: 'VERIFICADA' } }),
    );
    expect(org.estadoVerificacion).toBe('VERIFICADA');
  });
});

describe('modelos de cuentas', () => {
  it('MODELOS_TENANT incluye Invitacion y no los globales de plataforma', () => {
    expect(MODELOS_TENANT.has('Invitacion')).toBe(true);
    for (const m of ['TokenRestablecer', 'SlugAnterior', 'EventoAuditoria']) expect(MODELOS_TENANT.has(m)).toBe(false);
  });

  const operaciones = {
    TokenRestablecer: {
      findMany: () => prisma.tokenRestablecer.findMany(),
      create: (u: string) =>
        prisma.tokenRestablecer.create({ data: { usuarioId: u, tokenHash: `h-${u}`, expiraEn: new Date() } }),
    },
    SlugAnterior: {
      findMany: () => prisma.slugAnterior.findMany(),
      create: (_u: string, o: string) =>
        prisma.slugAnterior.create({ data: { slug: `viejo-${o}`, organizacionIdDestino: o } }),
    },
    EventoAuditoria: {
      findMany: () => prisma.eventoAuditoria.findMany(),
      create: () => prisma.eventoAuditoria.create({ data: { tipo: 'LOGIN' } }),
    },
  } as const;

  describe.each(Object.entries(operaciones))('%s fuera del modo plataforma', (_nombre, ops) => {
    it.each(['findMany', 'create'] as const)('con contexto de empresa, %s lanza ViolacionMultiempresaError', async (op) => {
      const { orgA, usuario } = await escenario();
      await expect(
        ejecutarEnTenant(orgA.id, () => (op === 'findMany' ? ops.findMany() : ops.create(usuario.id, orgA.id))),
      ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
    });

    it.each(['findMany', 'create'] as const)('sin contexto, %s lanza SinContextoTenantError', async (op) => {
      const { orgA, usuario } = await escenario();
      await expect(op === 'findMany' ? ops.findMany() : ops.create(usuario.id, orgA.id)).rejects.toBeInstanceOf(
        SinContextoTenantError,
      );
    });

    it('en modo plataforma funciona', async () => {
      const { orgA, usuario } = await escenario();
      await ejecutarComoPlataforma('prueba', async () => {
        await ops.create(usuario.id, orgA.id);
        expect(await ops.findMany()).toHaveLength(1);
      });
    });
  });
});

describe('Invitacion aislada por empresa', () => {
  it('una invitación de B no se ve desde A y crear con el organizacionId de B lanza', async () => {
    const { orgA, orgB } = await escenario();
    const invB = await crearInvitacion(orgB.id);
    const invA = await crearInvitacion(orgA.id);
    const vistas = await ejecutarEnTenant(orgA.id, () => prisma.invitacion.findMany());
    expect(vistas.map((i) => i.id)).toEqual([invA.id]);
    expect(await ejecutarEnTenant(orgA.id, () => prisma.invitacion.findUnique({ where: { id: invB.id } }))).toBeNull();
    await expect(
      ejecutarEnTenant(orgA.id, () =>
        prisma.invitacion.create({
          data: {
            organizacionId: orgB.id,
            email: 'x@ejemplo.test',
            rol: 'RECLUTADOR',
            tokenHash: 'zzz',
            expiraEn: new Date(),
            creadaPorId: '00000000-0000-4000-8000-000000000000',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });
});
