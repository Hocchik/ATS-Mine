import { beforeEach, describe, expect, it } from 'vitest';
import { ejecutarComoPlataforma, ejecutarEnTenant } from '../../src/tenant/contexto';
import { extenderConTenant } from '../../src/tenant/extension';
import { ViolacionMultiempresaError } from '../../src/tenant/relaciones';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

const prisma = extenderConTenant(prismaPrueba);
const HASH = 'no-usar';

async function escenario() {
  const org = await crearOrganizacion();
  const usuario = await crearUsuario();
  const membresia = await crearMembresia(usuario.id, org.id);
  return { org, usuario, membresia };
}

/** Cada consulta se arma con args `as never`: varias son inválidas a propósito para el tipado de Prisma. */
const enEmpresa = <T>(organizacionId: string, fn: () => T) => ejecutarEnTenant(organizacionId, fn);

beforeEach(limpiarBase);

describe('passwordHash en contexto de empresa: lo que se devuelve', () => {
  it('include anidado de usuario no trae el hash', async () => {
    const { org } = await escenario();
    const [fila] = await enEmpresa(org.id, () => prisma.membresia.findMany({ include: { usuario: true } }));
    expect(fila?.usuario).toBeDefined();
    expect(fila?.usuario).not.toHaveProperty('passwordHash');
  });

  it('la llamada encadenada .usuario() no trae el hash', async () => {
    const { org, membresia } = await escenario();
    const usuario = await enEmpresa(org.id, () =>
      prisma.membresia.findFirst({ where: { id: membresia.id } }).usuario(),
    );
    expect(usuario).toBeDefined();
    expect(usuario).not.toHaveProperty('passwordHash');
  });

  it('create con include usuario no trae el hash', async () => {
    const { org } = await escenario();
    const otro = await crearUsuario();
    const creada = await enEmpresa(org.id, () =>
      prisma.membresia.create({ data: { usuarioId: otro.id, rol: 'RECLUTADOR' }, include: { usuario: true } } as never),
    );
    expect((creada as { usuario: object }).usuario).not.toHaveProperty('passwordHash');
  });

  it('update con include usuario no trae el hash', async () => {
    const { org, membresia } = await escenario();
    const actualizada = await enEmpresa(org.id, () =>
      prisma.membresia.update({ where: { id: membresia.id }, data: { rol: 'ADMIN' }, include: { usuario: true } }),
    );
    expect(actualizada.usuario).not.toHaveProperty('passwordHash');
  });

  it('usuario.findMany sin select no trae el hash', async () => {
    const { org } = await escenario();
    const [usuario] = await enEmpresa(org.id, () => prisma.usuario.findMany());
    expect(usuario).toBeDefined();
    expect(usuario).not.toHaveProperty('passwordHash');
  });
});

describe('passwordHash en contexto de empresa: toda referencia se rechaza', () => {
  const casos: [string, (p: typeof prisma, ids: { membresiaId: string }) => Promise<unknown>][] = [
    ['select anidado', (p) => p.membresia.findMany({ select: { usuario: { select: { passwordHash: true } } } })],
    ['select directo', (p) => p.usuario.findMany({ select: { id: true, passwordHash: true } })],
    ['omit en false', (p) => p.usuario.findMany({ omit: { passwordHash: false } })],
    ['omit anidado en false', (p) => p.membresia.findMany({ include: { usuario: { omit: { passwordHash: false } } } })],
    ['groupBy por passwordHash', (p) => p.usuario.groupBy({ by: ['passwordHash'] } as never)],
    ['groupBy por passwordHash (escalar)', (p) => p.usuario.groupBy({ by: 'passwordHash' } as never)],
    ['aggregate _max', (p) => p.usuario.aggregate({ _max: { passwordHash: true } })],
    ['aggregate _min', (p) => p.usuario.aggregate({ _min: { passwordHash: true } })],
    ['count con _count', (p) => p.usuario.count({ select: { passwordHash: true } } as never)],
    ['filtro where.usuario.passwordHash', (p) => p.membresia.count({ where: { usuario: { passwordHash: { startsWith: 'x' } } } })],
    ['filtro where.passwordHash', (p) => p.usuario.findMany({ where: { passwordHash: { startsWith: 'n' } } })],
    ['filtro dentro de AND/OR', (p) => p.usuario.count({ where: { OR: [{ AND: [{ passwordHash: 'x' }] }] } })],
    ['orderBy', (p) => p.usuario.findMany({ orderBy: { passwordHash: 'asc' } })],
    ['orderBy anidado', (p) => p.membresia.findMany({ orderBy: { usuario: { passwordHash: 'asc' } } })],
    ['distinct', (p) => p.usuario.findMany({ distinct: ['passwordHash'] })],
    [
      'having',
      (p) => p.usuario.groupBy({ by: ['id'], having: { passwordHash: { _max: { startsWith: 'n' } } } } as never),
    ],
    ['update de una membresía con filtro por hash', (p, { membresiaId }) =>
      p.membresia.update({ where: { id: membresiaId, usuario: { passwordHash: 'x' } }, data: { rol: 'ADMIN' } }),
    ],
  ];

  it.each(casos)('%s → ViolacionMultiempresaError', async (_nombre, consulta) => {
    const { org, membresia } = await escenario();
    await expect(enEmpresa(org.id, () => consulta(prisma, { membresiaId: membresia.id }))).rejects.toBeInstanceOf(
      ViolacionMultiempresaError,
    );
  });

  it('también se rechaza sin contexto, antes que cualquier otra regla', async () => {
    await escenario();
    await expect(prisma.organizacion.findMany({ where: { passwordHash: 'x' } } as never)).rejects.toBeInstanceOf(
      ViolacionMultiempresaError,
    );
  });
});

describe('passwordHash en modo plataforma', () => {
  it('omit: { passwordHash: false } devuelve el hash', async () => {
    const { usuario } = await escenario();
    const fila = await ejecutarComoPlataforma('prueba de login', () =>
      prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id }, omit: { passwordHash: false } }),
    );
    expect(fila.passwordHash).toBe(HASH);
  });

  it('sin pedirlo, ni siquiera la plataforma recibe el hash (omit global)', async () => {
    const { usuario } = await escenario();
    const fila = await ejecutarComoPlataforma('prueba', () =>
      prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } }),
    );
    expect(fila).not.toHaveProperty('passwordHash');
  });
});

describe('referencias de columna (FieldRef) a passwordHash', () => {
  it('compararse contra prisma.usuario.fields.passwordHash se rechaza', async () => {
    const { org } = await escenario();
    await expect(
      enEmpresa(org.id, () =>
        prisma.membresia.count({ where: { usuario: { nombre: { gt: prisma.usuario.fields.passwordHash } } } } as never),
      ),
    ).rejects.toBeInstanceOf(ViolacionMultiempresaError);
  });
});
