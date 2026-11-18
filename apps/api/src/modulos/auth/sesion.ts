import type { Request } from 'express';
import { z } from 'zod';
import type { Modulo } from '../../app';
import { limpiarSesion } from '../../auth/cookies';
import { AppError } from '../../http/errores';
import { obtenerEmpresaActivaOpcional, obtenerSesion } from '../../http/sesion';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { emitirSesionFirmada, versionSesionVigente, type EmpresaActivaRespuesta } from './comun';

const cambiarEmpresaSchema = z.object({ organizacionId: z.uuid() });

const NO_AUTENTICADO = 'Inicia sesión para continuar';
const NO_ENCONTRADA = 'No encontrado';

/** Rutas de la propia persona: leen o cambian solo su sesión y sus membresías (filtradas por su usuarioId). */
const DATOS_PROPIOS = 'solo lee o cambia la sesión y las membresías de la propia persona (filtradas por su usuarioId)';

export function rutasSesion({ prisma, sesiones, seguridad }: DependenciasModulos): Modulo {
  const versionVigente = (req: Request, usuarioId: string) =>
    versionSesionVigente(req, { prisma, seguridad, motivo: 'auth.cambiar-empresa' }, usuarioId);

  return ({ registro, router }) => {
    const def = { acceso: 'AUTENTICADA', aislamiento: { noAplica: DATOS_PROPIOS } } as const;

    // Cierra TODAS las sesiones de la persona (decisión de diseño): sube versionSesion y luego vacía la caché del resolver.
    registro.definir(router, { metodo: 'post', ruta: '/api/auth/logout', ...def }, async (_req, res) => {
      const { usuarioId } = obtenerSesion(res);
      await ejecutarComoPlataforma('auth.logout', () =>
        prisma.usuario.update({ where: { id: usuarioId }, data: { versionSesion: { increment: 1 } }, select: { id: true } }),
      );
      sesiones.invalidarUsuario(usuarioId);
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
      // Primero la versión: un token revocado recibe siempre 401, tenga o no membresía en esa empresa.
      const versionSesion = await versionVigente(req, usuarioId);
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
