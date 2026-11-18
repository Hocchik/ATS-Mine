import type { Modulo } from '../../app';
import type { DependenciasModulos } from '..';
import { rutasAceptarInvitacion } from './aceptar';
import { rutasGestionInvitaciones } from './gestion';

/** Crear, listar y revocar invitaciones (OWNER/ADMIN), consultarlas por enlace (pública) y aceptarlas (autenticada). */
export function moduloInvitaciones(deps: DependenciasModulos): Modulo {
  const partes = [rutasGestionInvitaciones(deps), rutasAceptarInvitacion(deps)];
  return (ctx) => {
    for (const parte of partes) parte(ctx);
  };
}
