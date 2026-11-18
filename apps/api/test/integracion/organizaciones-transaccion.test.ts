import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/errores';
import { enTransaccionSerializable } from '../../src/modulos/organizaciones/comun';
import { ejecutarComoPlataforma } from '../../src/tenant/contexto';
import { extenderConTenant } from '../../src/tenant/extension';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';

beforeEach(limpiarBase);

const prisma = extenderConTenant(prismaPrueba);
const plataforma = <T>(fn: () => Promise<T>) => ejecutarComoPlataforma('prueba.transaccion', fn);

describe('enTransaccionSerializable', () => {
  it('dos degradaciones de OWNER intercaladas: la segunda se reintenta, ve la primera y no deja la empresa sin OWNER', async () => {
    const org = await crearOrganizacion();
    const a = await crearMembresia((await crearUsuario()).id, org.id, 'OWNER');
    const b = await crearMembresia((await crearUsuario()).id, org.id, 'OWNER');
    const owners = (tx: Parameters<Parameters<typeof enTransaccionSerializable>[1]>[0]) =>
      tx.membresia.count({ where: { organizacionId: org.id, rol: 'OWNER' } });
    let intentos = 0;

    const degradarA = plataforma(() =>
      enTransaccionSerializable(prisma, async (tx) => {
        intentos += 1;
        const cuantos = await owners(tx);
        if (intentos === 1) {
          // Mientras A está abierta (ya leyó el conteo), B hace la misma verificación, degrada y confirma.
          await enTransaccionSerializable(prisma, async (tx2) => {
            expect(await owners(tx2)).toBe(2);
            await tx2.membresia.update({ where: { id: b.id }, data: { rol: 'ADMIN' } });
          });
        }
        if (cuantos <= 1) throw new AppError('HAS_DEPENDENCIES', 'último OWNER');
        await tx.membresia.update({ where: { id: a.id }, data: { rol: 'ADMIN' } });
      }),
    );

    await expect(degradarA).rejects.toMatchObject({ code: 'HAS_DEPENDENCIES' });
    expect(intentos).toBe(2);
    expect(await prismaPrueba.membresia.count({ where: { organizacionId: org.id, rol: 'OWNER' } })).toBe(1);
  });
});
