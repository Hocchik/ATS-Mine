import { z } from 'zod';

export const ROLES = ['ADMIN', 'RECLUTADOR', 'ENTREVISTADOR', 'OWNER'] as const;
export type RolCuenta = (typeof ROLES)[number];

export const SLUGS_RESERVADOS: readonly string[] = [
  'app',
  'api',
  'public',
  'internal',
  'login',
  'registro',
  'seguimiento',
  'privacidad',
  'admin',
  'superadmin',
  'empleos',
  'static',
  'assets',
  'health',
  'invitacion',
  'restablecer',
  'www',
  'docs',
];

const MAX_BYTES_BCRYPT = 72;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(150)
  .pipe(z.email());

export const contrasenaSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .refine((s) => new TextEncoder().encode(s).length <= MAX_BYTES_BCRYPT, {
    message: 'La contraseña es demasiado larga (máximo 72 bytes)',
  });

/** Sin caracteres de control (NUL, saltos de línea, tabuladores, DEL): Postgres rechaza NUL y el resto ensucia listados y correos. */
// eslint-disable-next-line no-control-regex
const CARACTERES_DE_CONTROL = /[\u0000-\u001F\u007F]/;
const sinControl = (s: string) => !CARACTERES_DE_CONTROL.test(s);
const MENSAJE_CONTROL = 'No puede contener caracteres de control';
/** Textos de varias líneas: se admiten tabulador, salto de línea y retorno de carro; el resto de controles no. */
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPTO_ESPACIADO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const sinControlTexto = (s: string) => !CONTROL_EXCEPTO_ESPACIADO.test(s);

export const nombrePersonaSchema = z.string().trim().min(1).max(100).refine(sinControl, { message: MENSAJE_CONTROL });
const nombreOrganizacionSchema = z.string().trim().min(1).max(120).refine(sinControl, { message: MENSAJE_CONTROL });

export const slugSchema = z
  .string()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Slug inválido')
  .refine((s) => !s.includes('--'), { message: 'El slug no puede tener guiones consecutivos' })
  .refine((s) => !SLUGS_RESERVADOS.includes(s), { message: 'Ese slug está reservado' });

export const registroSchema = z.object({
  nombre: nombrePersonaSchema,
  email: emailSchema,
  contrasena: contrasenaSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  contrasena: z.string().min(1),
});

const zonasHorarias = new Set<string>(Intl.supportedValuesOf('timeZone'));
const zonaHorariaSchema = z
  .string()
  .refine((z) => z === 'UTC' || zonasHorarias.has(z), { message: 'Zona horaria inválida' });
const localeSchema = z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'Locale inválido');
const paisSchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'País inválido')
  .transform((s) => s.toUpperCase());

export const crearOrganizacionSchema = z.object({
  nombre: nombreOrganizacionSchema,
  slug: slugSchema,
  zonaHoraria: zonaHorariaSchema,
  locale: localeSchema,
  pais: paisSchema,
});

const urlHttpsSchema = z
  .string()
  .max(2000)
  .refine(
    (s) => {
      try {
        return new URL(s).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Debe ser una URL https' },
  );

// Las claves deben coincidir con CAMPOS_EDITABLES_ORGANIZACION (apps/api/src/tenant/globales.ts).
export const actualizarOrganizacionSchema = z
  .object({
    nombre: nombreOrganizacionSchema.optional(),
    slug: slugSchema.optional(),
    colorAcento: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Color inválido')
      .optional(),
    zonaHoraria: zonaHorariaSchema.optional(),
    locale: localeSchema.optional(),
    pais: paisSchema.optional(),
    sitioWeb: urlHttpsSchema.optional(),
    textoPrivacidad: z.string().max(20000).refine(sinControlTexto, { message: MENSAJE_CONTROL }).optional(),
    mensajeCierre: z.string().max(1000).refine(sinControlTexto, { message: MENSAJE_CONTROL }).optional(),
    retencionMeses: z.number().int().min(1).max(120).optional(),
    googleJobsHabilitado: z.boolean().optional(),
  })
  .strict();

export const crearInvitacionSchema = z.object({
  email: emailSchema,
  rol: z.enum(ROLES),
});

export const cambiarRolSchema = z.object({
  rol: z.enum(ROLES),
});
