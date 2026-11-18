import { crearPrismaBase } from '../src/db/prisma';
import { exigirBaseDePrueba } from './cargar-env';

/** Mismo cliente que producción (con el omit global), sin la extensión multiempresa. */
export const prismaPrueba = crearPrismaBase();

export async function limpiarBase(): Promise<void> {
  exigirBaseDePrueba();
  const tablas = await prismaPrueba.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tablas.length === 0) return;
  const lista = tablas.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prismaPrueba.$executeRawUnsafe(`TRUNCATE TABLE ${lista} CASCADE`);
}
