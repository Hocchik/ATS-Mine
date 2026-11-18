import { afterAll } from 'vitest';
import { cargarEnvPrueba } from './cargar-env';

cargarEnvPrueba();

afterAll(async () => {
  const { prismaPrueba } = await import('./db');
  await prismaPrueba.$disconnect();
});
