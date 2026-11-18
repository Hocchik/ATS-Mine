import type { EstadoVerificacion, Rol } from '@prisma/client';
import type { ResolverSesion, SesionUsuario } from '../http/sesion';
import { ejecutarComoPlataforma } from '../tenant/contexto';
import type { PrismaTenant } from '../tenant/extension';
import { CacheTTL } from './cache-ttl';
import { COOKIE_SESION } from './cookies';
import { verificarSesion } from './jwt';

const MOTIVO = 'auth.resolver';
const TTL_POR_DEFECTO_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DatosUsuario {
  versionSesion: number;
  esSuperadmin: boolean;
}

interface DatosMembresia {
  version: number;
  rol: Rol;
  usuarioId: string;
  organizacionId: string;
  estadoOrganizacion: EstadoVerificacion;
}

export interface DependenciasResolver {
  prisma: PrismaTenant;
  secreto: string;
  reloj?: () => number;
  ttlMs?: number;
}

/**
 * Resolver real: cookie → JWT → comprueba que `versionSesion` y `Membresia.version` sigan vigentes
 * y que la empresa no esté suspendida. Las lecturas se cachean por usuario y por membresía (60 s por defecto);
 * quien cambie roles, elimine miembros, suspenda empresas o restablezca contraseñas debe invalidar.
 */
export function crearResolverSesion({ prisma, secreto, reloj = Date.now, ttlMs = TTL_POR_DEFECTO_MS }: DependenciasResolver) {
  const usuarios = new CacheTTL<string, DatosUsuario>(ttlMs, reloj);
  const membresias = new CacheTTL<string, DatosMembresia>(ttlMs, reloj);

  async function datosUsuario(id: string): Promise<DatosUsuario | null> {
    const enCache = usuarios.obtener(id);
    if (enCache) return enCache;
    const fila = await ejecutarComoPlataforma(MOTIVO, () =>
      prisma.usuario.findUnique({ where: { id }, select: { versionSesion: true, esSuperadmin: true } }),
    );
    if (fila) usuarios.guardar(id, fila);
    return fila;
  }

  async function datosMembresia(id: string): Promise<DatosMembresia | null> {
    const enCache = membresias.obtener(id);
    if (enCache) return enCache;
    const fila = await ejecutarComoPlataforma(MOTIVO, () =>
      prisma.membresia.findUnique({
        where: { id },
        select: {
          version: true,
          rol: true,
          usuarioId: true,
          organizacionId: true,
          organizacion: { select: { estadoVerificacion: true } },
        },
      }),
    );
    if (!fila) return null;
    const { organizacion, ...resto } = fila;
    const datos: DatosMembresia = { ...resto, estadoOrganizacion: organizacion.estadoVerificacion };
    membresias.guardar(id, datos);
    return datos;
  }

  const resolver: ResolverSesion = async (req) => {
    const token: unknown = req.cookies?.[COOKIE_SESION];
    if (typeof token !== 'string' || !token) return null;
    const contenido = await verificarSesion(token, secreto, new Date(reloj()));
    if (!contenido || !UUID.test(contenido.usuarioId)) return null;

    const usuario = await datosUsuario(contenido.usuarioId);
    if (!usuario || usuario.versionSesion !== contenido.versionSesion) return null;
    const sesionUsuario: SesionUsuario = { usuarioId: contenido.usuarioId, esSuperadmin: usuario.esSuperadmin };

    const { empresa } = contenido;
    if (!empresa || !UUID.test(empresa.membresiaId)) return sesionUsuario;
    const membresia = await datosMembresia(empresa.membresiaId);
    const vigente =
      membresia !== null &&
      membresia.usuarioId === contenido.usuarioId &&
      membresia.organizacionId === empresa.organizacionId.toLowerCase() &&
      membresia.version === empresa.versionMembresia &&
      membresia.estadoOrganizacion !== 'SUSPENDIDA';
    // Membresía no vigente: la persona sigue autenticada, pero pierde la empresa.
    if (!vigente) return sesionUsuario;
    return {
      ...sesionUsuario,
      organizacionId: membresia.organizacionId,
      membresiaId: empresa.membresiaId,
      rol: membresia.rol,
    };
  };

  return {
    resolver,
    invalidarUsuario: (usuarioId: string) => usuarios.borrar(usuarioId),
    invalidarMembresia: (membresiaId: string) => membresias.borrar(membresiaId),
  };
}
