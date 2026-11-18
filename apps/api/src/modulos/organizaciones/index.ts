import type { Modulo } from '../../app';
import type { DependenciasModulos } from '..';
import { rutaCrearOrganizacion } from './crear';
import { rutasMiembros } from './miembros';
import { rutasOrganizacionPropia } from './propia';

/** Crear empresa, ver y editar la propia, y gestionar sus miembros (reglas de OWNER/ADMIN). */
export function moduloOrganizaciones(deps: DependenciasModulos): Modulo {
  const partes = [rutaCrearOrganizacion(deps), rutasOrganizacionPropia(deps), rutasMiembros(deps)];
  return (ctx) => {
    for (const parte of partes) parte(ctx);
  };
}
