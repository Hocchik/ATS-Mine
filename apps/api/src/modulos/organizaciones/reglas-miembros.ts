import type { Prisma, Rol } from '@prisma/client';
import { AppError } from '../../http/errores';
import type { TxTenant } from './comun';

/** Lo que se muestra de cada miembro: el usuario (global) se lee a través de una membresía de la propia empresa. */
export const SELECT_MIEMBRO = {
  id: true,
  rol: true,
  version: true,
  creadoEn: true,
  usuario: { select: { id: true, nombre: true, email: true } },
} satisfies Prisma.MembresiaSelect;

export type Miembro = Prisma.MembresiaGetPayload<{ select: typeof SELECT_MIEMBRO }>;

export interface ResultadoCambio {
  /** false: el rol pedido ya era el actual (no se toca la versión ni se audita). */
  cambio: boolean;
  /** Id canónico (el de la base, en minúsculas): con él se invalida la caché de sesiones. */
  membresiaId: string;
  usuarioId: string;
  rolAnterior: Rol;
  /** La membresía actualizada; null si se eliminó. */
  miembro: Miembro | null;
}

const NO_ENCONTRADO = 'No encontrado';
const SIN_PERMISO = 'No tienes permiso para esta acción';
const SOLO_OWNER = 'Solo un OWNER puede modificar a otro OWNER o asignar ese rol';
const ULTIMO_OWNER = 'La empresa no puede quedarse sin OWNER: asigna ese rol a otra persona antes';

/**
 * Cambia el rol (`rolNuevo`) o elimina (`rolNuevo: null`) una membresía de la empresa del contexto. Va dentro de una
 * transacción serializable: el rol de quien actúa y el conteo de OWNER se leen en la misma transacción que escribe.
 *  - Una membresía de otra empresa no coincide con el filtro → 404.
 *  - Un ADMIN no modifica ni elimina a un OWNER, ni asigna OWNER → 403.
 *  - El último OWNER no puede perder ese rol ni eliminarse → 409 HAS_DEPENDENCIES.
 *  - Todo cambio incrementa Membresia.version (invalida los tokens de esa membresía).
 */
export async function aplicarCambioDeMiembro(
  tx: TxTenant,
  { actorMembresiaId, membresiaId, rolNuevo }: { actorMembresiaId: string; membresiaId: string; rolNuevo: Rol | null },
): Promise<ResultadoCambio> {
  const objetivo = await tx.membresia.findUnique({ where: { id: membresiaId }, select: SELECT_MIEMBRO });
  if (!objetivo) throw new AppError('NOT_FOUND', NO_ENCONTRADO);
  const actor = await tx.membresia.findUnique({ where: { id: actorMembresiaId }, select: { rol: true } });
  if (!actor || (actor.rol !== 'OWNER' && actor.rol !== 'ADMIN')) throw new AppError('FORBIDDEN', SIN_PERMISO);
  if (actor.rol !== 'OWNER' && (objetivo.rol === 'OWNER' || rolNuevo === 'OWNER')) {
    throw new AppError('FORBIDDEN', SOLO_OWNER);
  }

  const base = { membresiaId: objetivo.id, usuarioId: objetivo.usuario.id, rolAnterior: objetivo.rol };
  if (rolNuevo === objetivo.rol) return { ...base, cambio: false, miembro: objetivo };

  if (objetivo.rol === 'OWNER') {
    const owners = await tx.membresia.count({ where: { rol: 'OWNER' } });
    if (owners <= 1) throw new AppError('HAS_DEPENDENCIES', ULTIMO_OWNER);
  }

  if (rolNuevo === null) {
    await tx.membresia.delete({ where: { id: membresiaId } });
    return { ...base, cambio: true, miembro: null };
  }
  const miembro = await tx.membresia.update({
    where: { id: membresiaId },
    data: { rol: rolNuevo, version: { increment: 1 } },
    select: SELECT_MIEMBRO,
  });
  return { ...base, cambio: true, miembro };
}
