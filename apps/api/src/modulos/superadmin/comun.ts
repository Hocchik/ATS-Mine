import type { EstadoVerificacion, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../http/errores';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { PrismaTenant } from '../../tenant/extension';
import { enTransaccionSerializable } from '../organizaciones/comun';

const paramsIdSchema = z.object({ id: z.uuid() });
const NO_ENCONTRADO = 'No encontrado';

export const noEncontrado = () => new AppError('NOT_FOUND', NO_ENCONTRADO);

/** `:id` de la ruta; uno mal formado responde igual que uno inexistente. Se llama DESPUÉS de la guardia. */
export function idDeParams(params: unknown): string {
  const resultado = paramsIdSchema.safeParse(params);
  if (!resultado.success) throw noEncontrado();
  return resultado.data.id;
}

/** Lo que el superadmin ve de una empresa tras una acción (incluye quién y cuándo la verificó). */
export const SELECT_ORG_PLATAFORMA = {
  id: true,
  nombre: true,
  slug: true,
  estadoVerificacion: true,
  verificadaPorId: true,
  verificadaEn: true,
  dominioCorreoVerificado: true,
  esDemo: true,
  creadoEn: true,
} satisfies Prisma.OrganizacionSelect;

type OrgPlataforma = Prisma.OrganizacionGetPayload<{ select: typeof SELECT_ORG_PLATAFORMA }>;

/** Estado nuevo según el actual, o null si no hay nada que cambiar. Puede lanzar un AppError. */
export type DecidirEstado = (actual: {
  estadoVerificacion: EstadoVerificacion;
  verificadaEn: Date | null;
}) => Prisma.OrganizacionUpdateInput | null;

export interface CambioDeEstado {
  org: OrgPlataforma;
  /** Membresías de la empresa al momento del cambio: el llamador las invalida en la caché DESPUÉS del commit. */
  membresiaIds: string[];
  cambio: boolean;
}

/**
 * Lee la empresa y sus membresías y aplica el cambio en una transacción SERIALIZABLE, en modo plataforma (los campos
 * de verificación solo se escriben ahí). Una aceptación de invitación simultánea no deja una membresía sin invalidar.
 */
export function cambiarEstadoOrganizacion(
  prisma: PrismaTenant,
  { id, motivo, decidir }: { id: string; motivo: string; decidir: DecidirEstado },
): Promise<CambioDeEstado> {
  return ejecutarComoPlataforma(motivo, () =>
    enTransaccionSerializable(prisma, async (tx) => {
      const actual = await tx.organizacion.findUnique({
        where: { id },
        select: { estadoVerificacion: true, verificadaEn: true },
      });
      if (!actual) throw noEncontrado();
      const membresias = await tx.membresia.findMany({ where: { organizacionId: id }, select: { id: true } });
      const membresiaIds = membresias.map((m) => m.id);
      const datos = decidir(actual);
      if (!datos) {
        const org = await tx.organizacion.findUniqueOrThrow({ where: { id }, select: SELECT_ORG_PLATAFORMA });
        return { org, membresiaIds, cambio: false };
      }
      const org = await tx.organizacion.update({ where: { id }, data: datos, select: SELECT_ORG_PLATAFORMA });
      return { org, membresiaIds, cambio: true };
    }),
  );
}
