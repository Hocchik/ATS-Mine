import type { Modulo } from '../../app';
import type { DependenciasModulos } from '..';
import { rutasUsarRestablecer } from './usar';

/** Restablecer la contraseña con el enlace de un solo uso que genera el superadmin (ruta pública). */
export function moduloRestablecer(deps: DependenciasModulos): Modulo {
  return rutasUsarRestablecer(deps);
}
