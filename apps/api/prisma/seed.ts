import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crearPrismaBase } from '../src/db/prisma';
import { extenderConTenant } from '../src/tenant/extension';
import { ErrorSeed, sembrarSuperadmin } from './sembrar-superadmin';

// Igual que server.ts: el archivo de entorno local se carga explícito si existe (en producción no existe).
const rutaEnvLocal = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rutaEnvLocal)) process.loadEnvFile(rutaEnvLocal);

async function main(): Promise<void> {
  const prismaBase = crearPrismaBase();
  try {
    const resultado = await sembrarSuperadmin(extenderConTenant(prismaBase), process.env);
    console.log(resultado.mensaje);
  } catch (err) {
    // Solo los mensajes propios: el de un error de Prisma podría repetir valores de la consulta.
    console.error(err instanceof ErrorSeed ? err.message : `El seed falló (${err instanceof Error ? err.name : 'error'}).`);
    process.exitCode = 1;
  } finally {
    await prismaBase.$disconnect();
  }
}

void main();
