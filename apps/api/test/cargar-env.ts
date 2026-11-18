import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUTA_ENV_PRUEBA = fileURLToPath(new URL('../.env.test', import.meta.url));

/** Lanza si DATABASE_URL no apunta a una base cuyo nombre termine en _test. Protege contra borrar dev o producción. */
export function exigirBaseDePrueba(): void {
  const mensaje = 'DATABASE_URL de pruebas debe apuntar a una base cuyo nombre termine en _test';
  let nombreBase: string;
  try {
    // Solo el nombre de la base (el path): `?application_name=x_test` no cuenta.
    nombreBase = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  } catch {
    throw new Error(mensaje);
  }
  if (!/_test$/.test(nombreBase)) throw new Error(mensaje);
}

export function cargarEnvPrueba(): void {
  if (existsSync(RUTA_ENV_PRUEBA)) process.loadEnvFile(RUTA_ENV_PRUEBA);
  process.env.NODE_ENV = 'test';
}
