import type { Modulo } from '../../app';
import type { DependenciasModulos } from '..';
import { rutasLogin } from './login';
import { rutasRegistro } from './registro';
import { rutasSesion } from './sesion';

/** Registro, login, logout, yo y cambio de empresa. Los limitadores se crean por app (memoria propia). */
export function moduloAuth(deps: DependenciasModulos): Modulo {
  const partes = [rutasRegistro(deps), rutasLogin(deps), rutasSesion(deps)];
  return (ctx) => {
    for (const parte of partes) parte(ctx);
  };
}
