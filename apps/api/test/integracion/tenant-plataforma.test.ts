import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComoPlataforma, ejecutarEnTenant } from '../../src/tenant/contexto';
import { extenderConTenant, SinContextoTenantError } from '../../src/tenant/extension';
import { GLOBALES_FUERA_DE_PLATAFORMA, ViolacionMultiempresaError } from '../../src/tenant/relaciones';
import { limpiarBase, prismaPrueba } from '../db';
import { crearInvitacion, crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

const prisma = extenderConTenant(prismaPrueba);

async function escenario() {
  const orgA = await crearOrganizacion({ nombre: 'A' });
  const orgB = await crearOrganizacion({ nombre: 'B' });
  const uA = await crearUsuario();
  const uB = await crearUsuario();
  await crearMembresia(uA.id, orgA.id);
  await crearMembresia(uB.id, orgB.id);
  await prismaPrueba.tokenRestablecer.create({
    data: { usuarioId: uA.id, tokenHash: 'HASH-SECRETO-A', expiraEn: new Date(Date.now() + 3600_000) },
  });
  await prismaPrueba.slugAnterior.create({ data: { slug: 'viejo-a', organizacionIdDestino: orgA.id } });
  await prismaPrueba.slugAnterior.create({ data: { slug: 'viejo-b', organizacionIdDestino: orgB.id } });
  return { orgA, orgB, uA, uB };
}

type Escenario = Awaited<ReturnType<typeof escenario>>;

beforeEach(limpiarBase);

describe('GLOBALES_FUERA_DE_PLATAFORMA', () => {
  it('solo Usuario y Organizacion', () => {
    expect([...GLOBALES_FUERA_DE_PLATAFORMA].sort()).toEqual(['Organizacion', 'Usuario']);
  });
});

/** Saltos global → global hacia modelos solo de plataforma, en contexto de empresa. */
const vectoresTenant: [string, (e: Escenario) => Promise<unknown>][] = [
  ['T1 include tokensRestablecer', () => prisma.usuario.findMany({ include: { tokensRestablecer: true } })],
  [
    'T2 select tokensRestablecer.tokenHash',
    () => prisma.usuario.findMany({ select: { id: true, tokensRestablecer: { select: { tokenHash: true } } } }),
  ],
  [
    'T3 where tokensRestablecer.some (oráculo)',
    () => prisma.usuario.count({ where: { tokensRestablecer: { some: { tokenHash: { startsWith: 'HASH-S' } } } } }),
  ],
  [
    'T4 select _count.tokensRestablecer',
    () => prisma.usuario.findMany({ select: { _count: { select: { tokensRestablecer: true } } } }),
  ],
  ['T5 fluent .tokensRestablecer()', (e) => prisma.usuario.findUnique({ where: { id: e.uA.id } }).tokensRestablecer()],
  [
    'T6 membresia → usuario → tokensRestablecer',
    () => prisma.membresia.findMany({ include: { usuario: { include: { tokensRestablecer: true } } } }),
  ],
  [
    'T7 orderBy tokensRestablecer._count',
    () => prisma.usuario.findMany({ orderBy: { tokensRestablecer: { _count: 'desc' } }, select: { id: true } }),
  ],
];

/** Saltos global → global hacia modelos solo de plataforma, sin contexto. */
const vectoresSinContexto: [string, (e: Escenario) => Promise<unknown>][] = [
  ['S1 include slugsAnteriores', () => prisma.organizacion.findMany({ include: { slugsAnteriores: true } })],
  [
    'S2 where slugsAnteriores.some',
    () =>
      prisma.organizacion.findFirst({
        where: { slugsAnteriores: { some: { slug: 'viejo-b' } } },
        select: { id: true },
      }),
  ],
  ['S3 fluent .slugsAnteriores()', (e) => prisma.organizacion.findUnique({ where: { id: e.orgB.id } }).slugsAnteriores()],
];

describe('saltos hacia modelos solo de plataforma en contexto de empresa', () => {
  it.each(vectoresTenant)('%s → ViolacionMultiempresaError', async (_nombre, consulta) => {
    const e = await escenario();
    await expect(ejecutarEnTenant(e.orgA.id, () => consulta(e))).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('invitacion → organizacion → slugsAnteriores se rechaza', async () => {
    const e = await escenario();
    await crearInvitacion(e.orgA.id);
    await expect(
      ejecutarEnTenant(e.orgA.id, () =>
        prisma.invitacion.findMany({ include: { organizacion: { include: { slugsAnteriores: true } } } }),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('organizacion → slugsAnteriores (la propia) también se rechaza', async () => {
    const e = await escenario();
    await expect(
      ejecutarEnTenant(e.orgA.id, () => prisma.organizacion.findMany({ include: { slugsAnteriores: true } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('tenant → Usuario y tenant → Organizacion siguen permitidos', async () => {
    const e = await escenario();
    const filas = await ejecutarEnTenant(e.orgA.id, () =>
      prisma.membresia.findMany({ include: { usuario: true, organizacion: true } }),
    );
    expect(filas.map((f) => [f.usuario.id, f.organizacion.id])).toEqual([[e.uA.id, e.orgA.id]]);
  });
});

describe('saltos hacia modelos solo de plataforma sin contexto', () => {
  it.each(vectoresSinContexto)('%s → SinContextoTenantError', async (_nombre, consulta) => {
    const e = await escenario();
    await expect(consulta(e)).rejects.toBeInstanceOf(SinContextoTenantError);
  });
});

describe('en modo plataforma las mismas lecturas funcionan', () => {
  it.each([...vectoresTenant, ...vectoresSinContexto])('%s', async (_nombre, consulta) => {
    const e = await escenario();
    await expect(ejecutarComoPlataforma('prueba', () => consulta(e))).resolves.toBeDefined();
  });

  it('T3 en plataforma encuentra al usuario por el filtro de relación', async () => {
    const e = await escenario();
    const n = await ejecutarComoPlataforma('prueba', () =>
      prisma.usuario.count({ where: { tokensRestablecer: { some: { tokenHash: { startsWith: 'HASH-S' } } } } }),
    );
    expect(n).toBe(1);
    expect(e.uA.id).toBeDefined();
  });
});

describe('tokenHash con omit global', () => {
  it('invitacion.findMany en contexto de empresa no devuelve tokenHash', async () => {
    const e = await escenario();
    await crearInvitacion(e.orgA.id);
    const [inv] = await ejecutarEnTenant(e.orgA.id, () => prisma.invitacion.findMany());
    expect(inv).toBeDefined();
    expect(inv).not.toHaveProperty('tokenHash');
  });

  it('invitacion se busca por where: { tokenHash } en modo plataforma (en contexto de empresa se rechaza)', async () => {
    const e = await escenario();
    const creada = await crearInvitacion(e.orgA.id);
    const fila = await prismaPrueba.invitacion.findUniqueOrThrow({ where: { id: creada.id }, omit: { tokenHash: false } });
    const hallada = await ejecutarComoPlataforma('aceptar invitación', () =>
      prisma.invitacion.findUnique({ where: { tokenHash: fila.tokenHash } }),
    );
    expect(hallada?.id).toBe(creada.id);
    await expect(
      ejecutarEnTenant(e.orgA.id, () => prisma.invitacion.findUnique({ where: { tokenHash: fila.tokenHash } })),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });

  it('tokenRestablecer.findMany en plataforma no devuelve tokenHash', async () => {
    await escenario();
    const [t] = await ejecutarComoPlataforma('prueba', () => prisma.tokenRestablecer.findMany());
    expect(t).toBeDefined();
    expect(t).not.toHaveProperty('tokenHash');
  });

  it('la plataforma puede pedirlo con omit: { tokenHash: false }', async () => {
    const e = await escenario();
    await crearInvitacion(e.orgA.id);
    const [t] = await ejecutarComoPlataforma('prueba', () =>
      prisma.tokenRestablecer.findMany({ omit: { tokenHash: false } }),
    );
    expect(t?.tokenHash).toBe('HASH-SECRETO-A');
    const [inv] = await ejecutarComoPlataforma('prueba', () => prisma.invitacion.findMany({ omit: { tokenHash: false } }));
    expect(typeof inv?.tokenHash).toBe('string');
  });
});
