import type { Request } from 'express';
import { z } from 'zod';
import type { Modulo } from '../../app';
import { COOKIE_SESION, limpiarSesion } from '../../auth/cookies';
import { verificarSesion } from '../../auth/jwt';
import { AppError } from '../../http/errores';
import { obtenerEmpresaActivaOpcional, obtenerSesion } from '../../http/sesion';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { emitirSesionFirmada, type EmpresaActivaRespuesta } from './comun';

const cambiarEmpresaSchema = z.object({ organizacionId: z.uuid() });

const NO_AUTENTICADO = 'Inicia sesión para continuar';
const NO_ENCONTRADA = 'No encontrado';

/** Rutas de la propia persona: leen o cambian solo su sesión y sus membresías (filtradas por su usuarioId). */
const DATOS_PROPIOS = 'solo lee o cambia la sesión y las membresías de la propia persona (filtradas por su usuarioId)';

export function rutasSesion({ prisma, seguridad }: DependenciasModulos): Modulo {
  /**
   * `versionSesion` del token de la cookie (el resolver ya lo validó, quizá desde su caché). Se reutiliza al volver a
   * firmar, y se exige igual al de la base: un token invalidado nunca obtiene uno nuevo con la versión vigente.
   */
  async function versionVigente(req: Request, usuarioId: string): Promise<number> {
    const token: unknown = req.cookies?.[COOKIE_SESION];
    const contenido = typeof token === 'string' ? await verificarSesion(token, seguridad.jwtSecret) : null;
    const usuario = await ejecutarComoPlataforma('auth.cambiar-empresa', () =>
      prisma.usuario.findUnique({ where: { id: usuarioId }, select: { versionSesion: true } }),
    );
    if (!contenido || contenido.usuarioId !== usuarioId || usuario?.versionSesion !== contenido.versionSesion) {
      throw new AppError('UNAUTHENTICATED', NO_AUTENTICADO);
    }
    return contenido.versionSesion;
  }

  return ({ registro, router }) => {
    const def = { acceso: 'AUTENTICADA', aislamiento: { noAplica: DATOS_PROPIOS } } as const;

    registro.definir(router, { metodo: 'post', ruta: '/api/auth/logout', ...def }, (_req, res) => {
      limpiarSesion(res, { segura: seguridad.cookiesSeguras });
      res.status(204).end();
    });

    registro.definir(router, { metodo: 'get', ruta: '/api/auth/yo', ...def }, async (_req, res) => {
      const { usuarioId } = obtenerSesion(res);
      const { usuario, membresias } = await ejecutarComoPlataforma('auth.yo', async () => ({
        usuario: await prisma.usuario.findUnique({
          where: { id: usuarioId },
          select: { id: true, nombre: true, email: true, esSuperadmin: true },
        }),
        membresias: await prisma.membresia.findMany({
          where: { usuarioId },
          orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
          select: {
            organizacionId: true,
            rol: true,
            organizacion: { select: { nombre: true, slug: true, estadoVerificacion: true } },
          },
        }),
      }));
      if (!usuario) throw new AppError('UNAUTHENTICATED', NO_AUTENTICADO);

      const empresas = membresias.map((m) => ({
        organizacionId: m.organizacionId,
        nombre: m.organizacion.nombre,
        slug: m.organizacion.slug,
        rol: m.rol,
        estadoVerificacion: m.organizacion.estadoVerificacion,
      }));
      // La activa sale de la sesión ya resuelta (membresía vigente y empresa no suspendida), cruzada con la lista propia.
      const activa = obtenerEmpresaActivaOpcional(res);
      const fila = activa ? empresas.find((e) => e.organizacionId === activa.organizacionId) : undefined;
      const empresaActiva: EmpresaActivaRespuesta | null =
        activa && fila ? { organizacionId: fila.organizacionId, nombre: fila.nombre, slug: fila.slug, rol: activa.rol } : null;
      res.json({ usuario, empresas, empresaActiva });
    });

    registro.definir(router, { metodo: 'post', ruta: '/api/auth/cambiar-empresa', ...def }, async (req, res) => {
      const { usuarioId } = obtenerSesion(res);
      const { organizacionId } = cambiarEmpresaSchema.parse(req.body);
      const membresia = await ejecutarComoPlataforma('auth.cambiar-empresa', () =>
        prisma.membresia.findUnique({
          where: { usuarioId_organizacionId: { usuarioId, organizacionId } },
          select: {
            id: true,
            organizacionId: true,
            rol: true,
            version: true,
            organizacion: { select: { nombre: true, slug: true, estadoVerificacion: true } },
          },
        }),
      );
      // Sin membresía o con la empresa suspendida: 404, igual que cualquier recurso ajeno.
      if (!membresia || membresia.organizacion.estadoVerificacion === 'SUSPENDIDA') {
        throw new AppError('NOT_FOUND', NO_ENCONTRADA);
      }

      const versionSesion = await versionVigente(req, usuarioId);
      await emitirSesionFirmada(res, seguridad, {
        usuarioId,
        versionSesion,
        empresa: { organizacionId: membresia.organizacionId, membresiaId: membresia.id, versionMembresia: membresia.version },
      });
      const empresaActiva: EmpresaActivaRespuesta = {
        organizacionId: membresia.organizacionId,
        nombre: membresia.organizacion.nombre,
        slug: membresia.organizacion.slug,
        rol: membresia.rol,
      };
      res.json({ empresaActiva });
    });
  };
}
