import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crearApp } from './app';
import { cargarConfig } from './config';
import { crearPrismaBase } from './db/prisma';
import { sinSesion } from './http/sesion';
import { crearLogger } from './logger';
import { modulosDeLaApp } from './modulos';
import { extenderConTenant } from './tenant/extension';

// Prisma 6 carga el archivo de entorno de forma implícita; no depender de ello: aquí se carga explícito si existe.
// En producción no existe y el host inyecta las variables.
const rutaEnvLocal = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rutaEnvLocal)) process.loadEnvFile(rutaEnvLocal);

const config = cargarConfig();
const logger = crearLogger(config.LOG_LEVEL);
const prismaBase = crearPrismaBase();
const prisma = extenderConTenant(prismaBase);

const { app } = crearApp({
  logger,
  resolverSesion: sinSesion,
  modulos: modulosDeLaApp({ prisma }),
});

const server = app.listen(config.PORT, () => logger.info({ puerto: config.PORT }, 'API escuchando'));

// Apagado ordenado: deja de aceptar conexiones, termina las peticiones en curso y cierra el pool de Prisma.
let apagando = false;
function apagar(senal: NodeJS.Signals): void {
  if (apagando) return;
  apagando = true;
  logger.info({ senal }, 'Apagando la API');
  // Si algo queda colgado, no bloquear el apagado indefinidamente.
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close((error) => {
    if (error) logger.error({ err: error }, 'Error al cerrar el servidor HTTP');
    prismaBase
      .$disconnect()
      .catch((err: unknown) => logger.error({ err }, 'Error al desconectar Prisma'))
      .finally(() => process.exit(error ? 1 : 0));
  });
}
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
