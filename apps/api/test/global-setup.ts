import { execSync } from 'node:child_process';
import { cargarEnvPrueba, exigirBaseDePrueba } from './cargar-env';

export default function setup(): void {
  cargarEnvPrueba();
  exigirBaseDePrueba();
  // No destructivo: solo aplica migraciones pendientes. Cada prueba limpia sus tablas con limpiarBase().
  // Si una migración ya aplicada cambió, una persona debe reiniciar criterio_test a mano.
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}
