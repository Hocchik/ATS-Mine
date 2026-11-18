import { emailSchema } from '@criterio/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hashToken } from '../../auth/tokens-aleatorios';
import { AppError } from '../../http/errores';
import type { TxTenant } from '../organizaciones/comun';

/** generarToken(): 32 bytes en base64url, sin relleno → exactamente 43 caracteres. */
const paramsTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/** Un solo mensaje para inexistente, mal formada, vencida, revocada, aceptada u otro email: no revela cuál. */
const MENSAJE_TOKEN = 'El enlace de invitación no es válido o ya no está disponible';

export const tokenInvalido = () => new AppError('TOKEN_INVALIDO', MENSAJE_TOKEN);

/** Valida el formato del `:token` antes de cualquier consulta; uno mal formado responde igual que uno inexistente. */
export function tokenDeParams(params: unknown): string {
  const resultado = paramsTokenSchema.safeParse(params);
  if (!resultado.success) throw tokenInvalido();
  return resultado.data.token;
}

const SELECT_POR_TOKEN = {
  id: true,
  organizacionId: true,
  email: true,
  rol: true,
  expiraEn: true,
  aceptadaEn: true,
  revocadaEn: true,
  organizacion: { select: { nombre: true, slug: true, estadoVerificacion: true } },
} satisfies Prisma.InvitacionSelect;

export type InvitacionPorToken = Prisma.InvitacionGetPayload<{ select: typeof SELECT_POR_TOKEN }>;

/**
 * Invitación vigente con ese token (no aceptada, no revocada, no vencida, de una empresa no suspendida) o
 * TOKEN_INVALIDO. Busca por `tokenHash`, un campo secreto: el llamador DEBE estar en modo plataforma.
 */
export async function invitacionVigente(
  cliente: { invitacion: TxTenant['invitacion'] },
  token: string,
  ahora = new Date(),
): Promise<InvitacionPorToken> {
  const invitacion = await cliente.invitacion.findUnique({
    where: { tokenHash: hashToken(token) },
    select: SELECT_POR_TOKEN,
  });
  const vigente =
    invitacion !== null &&
    invitacion.aceptadaEn === null &&
    invitacion.revocadaEn === null &&
    invitacion.expiraEn.getTime() > ahora.getTime() &&
    invitacion.organizacion.estadoVerificacion !== 'SUSPENDIDA';
  if (!vigente) throw tokenInvalido();
  return invitacion;
}

/** Compara dos emails con la misma normalización que el registro y la invitación (emailSchema). */
export function mismoEmail(a: string, b: string): boolean {
  const na = emailSchema.safeParse(a);
  const nb = emailSchema.safeParse(b);
  return na.success && nb.success && na.data === nb.data;
}
