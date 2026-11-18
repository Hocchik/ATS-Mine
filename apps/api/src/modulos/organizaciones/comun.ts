import { Prisma } from '@prisma/client';
import { AppError } from '../../http/errores';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { PrismaTenant } from '../../tenant/extension';

/** Cliente de una transacción interactiva del cliente multiempresa (el filtro sigue aplicando dentro). */
export type TxTenant = Parameters<Parameters<PrismaTenant['$transaction']>[0]>[0];

/** Campos de la empresa que ve su propio equipo (sin quién la verificó). */
export const SELECT_ORGANIZACION = {
  id: true,
  nombre: true,
  slug: true,
  logoClave: true,
  colorAcento: true,
  zonaHoraria: true,
  locale: true,
  pais: true,
  sitioWeb: true,
  textoPrivacidad: true,
  mensajeCierre: true,
  retencionMeses: true,
  estadoVerificacion: true,
  esDemo: true,
  googleJobsHabilitado: true,
  creadoEn: true,
} satisfies Prisma.OrganizacionSelect;

const MOTIVO_SLUG = 'organizaciones.slug';
const SLUG_OCUPADO = 'Ese slug ya está en uso';
const INTENTOS_SERIALIZABLE = 3;
const CONFLICTO = 'Otro cambio se hizo al mismo tiempo; intenta de nuevo';

const esConflictoDeSerializacion = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

/**
 * Transacción SERIALIZABLE con reintentos. Las reglas de esta área leen y luego escriben filas distintas
 * ("queda otro OWNER", "el slug no está en Organizacion ni en SlugAnterior"): con READ COMMITTED, dos peticiones
 * simultáneas podrían pasar ambas la verificación. Con SERIALIZABLE, Postgres aborta una (P2034) y se reintenta.
 */
export async function enTransaccionSerializable<T>(prisma: PrismaTenant, fn: (tx: TxTenant) => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      if (!esConflictoDeSerializacion(err)) throw err;
      if (intento >= INTENTOS_SERIALIZABLE) throw new AppError('VERSION_CONFLICT', CONFLICTO);
    }
  }
}

/**
 * Dueño actual de un slug: la empresa que lo usa o, si figura como anterior, la empresa a la que redirige.
 * SlugAnterior es solo de plataforma y la búsqueda por slug tiene que ver todas las empresas: modo plataforma,
 * sobre el mismo `tx` (misma transacción).
 */
function duenoDelSlug(tx: TxTenant, slug: string) {
  return ejecutarComoPlataforma(MOTIVO_SLUG, async () => {
    const usada = await tx.organizacion.findUnique({ where: { slug }, select: { id: true } });
    const anterior = await tx.slugAnterior.findUnique({ where: { slug }, select: { organizacionIdDestino: true } });
    return { usadaPor: usada?.id ?? null, anteriorDe: anterior?.organizacionIdDestino ?? null };
  });
}

/** Para crear una empresa: el slug no puede estar en uso ni figurar como anterior de nadie. */
export async function exigirSlugLibre(tx: TxTenant, slug: string): Promise<void> {
  const { usadaPor, anteriorDe } = await duenoDelSlug(tx, slug);
  if (usadaPor || anteriorDe) throw new AppError('DUPLICATE', SLUG_OCUPADO);
}

/**
 * Cambio de slug de una empresa: el nuevo no puede estar en uso ni ser anterior de OTRA empresa (sí puede recuperar
 * uno propio). El actual queda reservado en SlugAnterior, apuntando a la empresa.
 */
export async function cambiarSlug(
  tx: TxTenant,
  { organizacionId, slugActual, slugNuevo }: { organizacionId: string; slugActual: string; slugNuevo: string },
): Promise<void> {
  const { usadaPor, anteriorDe } = await duenoDelSlug(tx, slugNuevo);
  if (usadaPor || (anteriorDe && anteriorDe !== organizacionId)) throw new AppError('DUPLICATE', SLUG_OCUPADO);
  await ejecutarComoPlataforma(MOTIVO_SLUG, async () => {
    if (anteriorDe) await tx.slugAnterior.delete({ where: { slug: slugNuevo } });
    await tx.slugAnterior.create({ data: { slug: slugActual, organizacionIdDestino: organizacionId } });
  });
}
