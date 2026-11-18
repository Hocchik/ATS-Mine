import { z } from 'zod';

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof esquema>;

export function cargarConfig(env: Record<string, string | undefined> = process.env): Config {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const variables = resultado.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración inválida: ${variables}`);
  }
  return resultado.data;
}
