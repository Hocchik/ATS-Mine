import type { Modulo } from '../app';
import type { PrismaTenant } from '../tenant/extension';
import { moduloSistema } from './sistema';

/** Los módulos solo reciben el cliente con filtro multiempresa; el modo plataforma se pide con ejecutarComoPlataforma. */
export interface DependenciasModulos {
  prisma: PrismaTenant;
}

/** Única lista de módulos: la usan server.ts y la suite de aislamiento. Todo módulo nuevo se agrega aquí. */
export function modulosDeLaApp(_deps: DependenciasModulos): Modulo[] {
  return [moduloSistema()];
}
