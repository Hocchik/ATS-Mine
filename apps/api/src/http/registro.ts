import type { RequestHandler, Router } from 'express';
import type { PrismaBase } from '../db/prisma';
import { exigirTenant, type ResolverSesion } from './sesion';

/** PUBLICA: sin sesión. TENANT: exige sesión y corre en el contexto de su empresa. Las fases siguientes agregan INTERNA y PLATAFORMA. */
export type Acceso = 'PUBLICA' | 'TENANT';
export type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ResultadoEscenario =
  | { tipo: 'RECURSO'; ruta: string; cuerpo?: unknown }
  | { tipo: 'COLECCION'; ruta: string; marcador: string };

export interface EscenarioAislamiento {
  /** Crea en la empresa `organizacionId` lo que la ruta expone y devuelve la petición a probar desde otra empresa. */
  preparar: (ctx: { organizacionId: string; prisma: PrismaBase }) => Promise<ResultadoEscenario>;
}

export interface DefinicionRuta {
  metodo: Metodo;
  /** Ruta completa, p. ej. `/api/vacantes/:id`. */
  ruta: string;
  acceso: Acceso;
  aislamiento?: EscenarioAislamiento;
}

export interface RegistroRutas {
  readonly definiciones: readonly DefinicionRuta[];
  definir: (router: Router, def: DefinicionRuta, ...handlers: RequestHandler[]) => void;
}

export function crearRegistro(resolverSesion: ResolverSesion): RegistroRutas {
  const definiciones: DefinicionRuta[] = [];
  const guardiaTenant = exigirTenant(resolverSesion);
  return {
    definiciones,
    definir(router, def, ...handlers) {
      const nombre = `${def.metodo.toUpperCase()} ${def.ruta}`;
      let cadena: RequestHandler[];
      // switch exhaustivo: un valor nuevo de Acceso sin manejar rompe la compilación (y en tiempo de ejecución, lanza).
      switch (def.acceso) {
        case 'PUBLICA':
          cadena = handlers;
          break;
        case 'TENANT':
          if (!def.aislamiento) throw new Error(`La ruta TENANT ${nombre} no tiene escenario de aislamiento`);
          cadena = [guardiaTenant, ...handlers];
          break;
        default: {
          const _exhaustivo: never = def.acceso;
          throw new Error(`Acceso desconocido ${String(_exhaustivo)} en la ruta ${nombre}`);
        }
      }
      definiciones.push(def);
      router[def.metodo](def.ruta, ...cadena);
    },
  };
}
