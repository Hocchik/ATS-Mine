import { contrasenaSchema, emailSchema } from '@criterio/shared';
import { COSTO_BCRYPT, hashearContrasena } from '../src/auth/contrasenas';
import { ejecutarComoPlataforma } from '../src/tenant/contexto';
import type { PrismaTenant } from '../src/tenant/extension';

const NOMBRE_SUPERADMIN = 'Superadmin';
const AMBAS = 'Define SEED_SUPERADMIN_EMAIL y SEED_SUPERADMIN_PASSWORD';

/** Error de configuración del seed: su mensaje es seguro de mostrar (nunca repite los valores de las variables). */
export class ErrorSeed extends Error {
  override name = 'ErrorSeed';
}

export interface ResultadoSeed {
  estado: 'SIN_VARIABLES' | 'CREADO' | 'ACTUALIZADO';
  /** Mensaje para la consola, sin datos personales. */
  mensaje: string;
}

/**
 * Crea o actualiza al superadmin con SEED_SUPERADMIN_EMAIL y SEED_SUPERADMIN_PASSWORD (validados con los esquemas de
 * shared). Sin ninguna de las dos no hace nada; con una sola o con valores inválidos lanza ErrorSeed sin escribir.
 * Si la persona ya existe: queda como superadmin, con el hash nuevo y `versionSesion` incrementada.
 */
export async function sembrarSuperadmin(
  prisma: PrismaTenant,
  env: Record<string, string | undefined>,
  { costo = COSTO_BCRYPT }: { costo?: number } = {},
): Promise<ResultadoSeed> {
  const emailCrudo = env.SEED_SUPERADMIN_EMAIL;
  const contrasenaCruda = env.SEED_SUPERADMIN_PASSWORD;
  if (!emailCrudo && !contrasenaCruda) {
    return {
      estado: 'SIN_VARIABLES',
      mensaje: `Sin SEED_SUPERADMIN_EMAIL ni SEED_SUPERADMIN_PASSWORD: no se creó ningún superadmin. ${AMBAS} para sembrarlo.`,
    };
  }
  if (!emailCrudo || !contrasenaCruda) throw new ErrorSeed(`Falta una de las variables. ${AMBAS}.`);

  const email = emailSchema.safeParse(emailCrudo);
  if (!email.success) throw new ErrorSeed('SEED_SUPERADMIN_EMAIL no es un email válido.');
  const contrasena = contrasenaSchema.safeParse(contrasenaCruda);
  if (!contrasena.success) {
    const motivo = contrasena.error.issues[0]?.message ?? 'no cumple las reglas';
    throw new ErrorSeed(`SEED_SUPERADMIN_PASSWORD no es válida: ${motivo}.`);
  }
  const passwordHash = await hashearContrasena(contrasena.data, costo);

  // Usuario solo se escribe en modo plataforma.
  return ejecutarComoPlataforma('seed.superadmin', async (): Promise<ResultadoSeed> => {
    const existente = await prisma.usuario.findUnique({ where: { email: email.data }, select: { id: true } });
    if (existente) {
      await prisma.usuario.update({
        where: { id: existente.id },
        data: { esSuperadmin: true, passwordHash, versionSesion: { increment: 1 } },
        select: { id: true },
      });
      return { estado: 'ACTUALIZADO', mensaje: 'Superadmin actualizado: contraseña nueva y sesiones anteriores cerradas.' };
    }
    await prisma.usuario.create({
      data: { email: email.data, nombre: NOMBRE_SUPERADMIN, passwordHash, esSuperadmin: true },
      select: { id: true },
    });
    return { estado: 'CREADO', mensaje: 'Superadmin creado.' };
  });
}
