import type { Modulo, Seguridad } from '../app';
import type { SesionesApp } from '../auth/resolver-sesion';
import type { PrismaTenant } from '../tenant/extension';
import { moduloAuth } from './auth';
import { moduloInvitaciones } from './invitaciones';
import { moduloOrganizaciones } from './organizaciones';
import { moduloSistema } from './sistema';

/** Los módulos solo reciben el cliente con filtro multiempresa; el modo plataforma se pide con ejecutarComoPlataforma. */
export interface DependenciasModulos {
  prisma: PrismaTenant;
  /** Lo que devuelve crearResolverSesion: quien cambie roles, membresías o versiones de sesión invalida su caché. */
  sesiones: SesionesApp;
  /** El mismo objeto que recibe crearApp (secreto JWT, cookies seguras, origen web). */
  seguridad: Seguridad;
}

/** Única lista de módulos: la usan server.ts y la suite de aislamiento. Todo módulo nuevo se agrega aquí. */
export function modulosDeLaApp(deps: DependenciasModulos): Modulo[] {
  return [moduloSistema(), moduloAuth(deps), moduloOrganizaciones(deps), moduloInvitaciones(deps)];
}
