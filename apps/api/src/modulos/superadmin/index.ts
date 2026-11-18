import type { Modulo } from '../../app';
import type { DependenciasModulos } from '..';
import { rutasEnlaceRestablecer } from './enlace-restablecer';
import { rutasSuperadminOrganizaciones } from './organizaciones';

/** Rutas PLATAFORMA (solo superadmin): empresas (listar, verificar, suspender, reactivar) y enlace de restablecer. */
export function moduloSuperadmin(deps: DependenciasModulos): Modulo {
  const partes = [rutasSuperadminOrganizaciones(deps), rutasEnlaceRestablecer(deps)];
  return (ctx) => {
    for (const parte of partes) parte(ctx);
  };
}
