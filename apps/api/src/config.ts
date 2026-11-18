import { z } from 'zod';

const esquemaBase = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(32),
  WEB_ORIGIN: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v), 'Debe ser http(s)')
    .refine((v) => !v.endsWith('/'), 'No debe terminar en /'),
  EDGE_SECRET: z.string().min(32).optional(),
});

const esquema = esquemaBase.superRefine((cfg, ctx) => {
  if (cfg.NODE_ENV === 'production' && !cfg.EDGE_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['EDGE_SECRET'], message: 'Requerido en producción' });
  }
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
