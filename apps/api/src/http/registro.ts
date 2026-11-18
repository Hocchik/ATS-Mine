import type { Rol } from '@prisma/client';
import type { RequestHandler, Router } from 'express';
import type { PrismaBase } from '../db/prisma';
import { verificarCsrf } from './csrf';
import {
  correrEnTenant,
  exigirAutenticado,
  exigirEmpresa,
  exigirRol,
  exigirSuperadmin,
  type ResolverSesion,
} from './sesion';

/**
 * PUBLICA: sin sesión.
 * AUTENTICADA: sesión (con o sin empresa) + CSRF; corre fuera de cualquier contexto de empresa.
 * TENANT: sesión con empresa (+ roles opcionales) + CSRF; corre en el contexto de su empresa.
 * PLATAFORMA: solo superadmin + CSRF; los handlers deciden qué corre con ejecutarComoPlataforma.
 */
export type Acceso = 'PUBLICA' | 'AUTENTICADA' | 'TENANT' | 'PLATAFORMA';
export type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ResultadoEscenario =
  | { tipo: 'RECURSO'; ruta: string; cuerpo?: unknown }
  | { tipo: 'COLECCION'; ruta: string; marcador: string };

export interface EscenarioAislamiento {
  /** Crea en la empresa `organizacionId` lo que la ruta expone y devuelve la petición a probar desde otra empresa. */
  preparar: (ctx: { organizacionId: string; prisma: PrismaBase }) => Promise<ResultadoEscenario>;
}

/** `noAplica` (solo AUTENTICADA): la ruta no expone datos de empresas; el motivo queda escrito en la definición. */
export type Aislamiento = EscenarioAislamiento | { noAplica: string };

export const esNoAplica = (a: Aislamiento): a is { noAplica: string } => 'noAplica' in a;

export interface DefinicionRuta {
  metodo: Metodo;
  /** Ruta completa, p. ej. `/api/vacantes/:id`. */
  ruta: string;
  acceso: Acceso;
  /** Solo TENANT. Sin roles: cualquier miembro de la empresa. */
  roles?: readonly Rol[];
  /** TENANT: escenario obligatorio. AUTENTICADA: obligatorio (escenario o noAplica). PUBLICA/PLATAFORMA: no se declara. */
  aislamiento?: Aislamiento;
}

export interface RegistroRutas {
  readonly definiciones: readonly DefinicionRuta[];
  definir: (router: Router, def: DefinicionRuta, ...handlers: RequestHandler[]) => void;
}

export function crearRegistro({ resolverSesion, webOrigin }: { resolverSesion: ResolverSesion; webOrigin: string }): RegistroRutas {
  const definiciones: DefinicionRuta[] = [];
  const autenticado = exigirAutenticado(resolverSesion);
  const csrf = verificarCsrf(webOrigin);
  return {
    definiciones,
    definir(router, def, ...handlers) {
      const nombre = `${def.metodo.toUpperCase()} ${def.ruta}`;
      const falla = (motivo: string): never => {
        throw new Error(`La ruta ${def.acceso} ${nombre} ${motivo}`);
      };
      if (def.roles !== undefined && def.acceso !== 'TENANT') falla('declara roles: solo las rutas TENANT los usan');
      if (def.aislamiento && esNoAplica(def.aislamiento) && !def.aislamiento.noAplica.trim()) {
        falla('declara noAplica sin motivo');
      }

      let cadena: RequestHandler[];
      // switch exhaustivo: un valor nuevo de Acceso sin manejar rompe la compilación (y en tiempo de ejecución, lanza).
      switch (def.acceso) {
        case 'PUBLICA':
          if (def.aislamiento) falla('no declara aislamiento: es pública');
          cadena = handlers;
          break;
        case 'AUTENTICADA':
          if (!def.aislamiento) falla('necesita aislamiento: un escenario o { noAplica: motivo }');
          cadena = [autenticado, csrf, ...handlers];
          break;
        case 'TENANT':
          if (!def.aislamiento || esNoAplica(def.aislamiento)) falla('no tiene escenario de aislamiento');
          if (def.roles?.length === 0) falla('declara una lista de roles vacía (omite roles para cualquier miembro)');
          cadena = [autenticado, exigirEmpresa, exigirRol(def.roles), csrf, correrEnTenant, ...handlers];
          break;
        case 'PLATAFORMA':
          if (def.aislamiento) falla('no declara aislamiento: el verificador exige 403 a quien no es superadmin');
          cadena = [autenticado, exigirSuperadmin, csrf, ...handlers];
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
