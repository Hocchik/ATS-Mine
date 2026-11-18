import { EstadoVerificacion, type TipoEventoAuditoria } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { ipCliente } from '../../http/edge';
import { AppError } from '../../http/errores';
import { obtenerSesion } from '../../http/sesion';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { cambiarEstadoOrganizacion, idDeParams, type DecidirEstado } from './comun';

const RUTA = '/api/superadmin/organizaciones';
const listarQuerySchema = z.object({ estado: z.enum(EstadoVerificacion).optional() });
const verificarCuerpoSchema = z.strictObject({ dominioCorreoVerificado: z.boolean().optional() });
const SUSPENDIDA = 'La empresa está suspendida: reactívala antes de verificarla';

/** Listar empresas y verificar, suspender o reactivar una. Solo superadmin; todo corre en modo plataforma. */
export function rutasSuperadminOrganizaciones({ prisma, sesiones }: DependenciasModulos): Modulo {
  /** Aplica el cambio, invalida las membresías de la empresa DESPUÉS del commit y audita si hubo cambio. */
  async function accion(
    req: Request,
    res: Response,
    { tipo, decidir, invalidar }: { tipo: TipoEventoAuditoria; decidir: DecidirEstado; invalidar: boolean },
  ) {
    const { usuarioId } = obtenerSesion(res);
    const id = idDeParams(req.params);
    const resultado = await cambiarEstadoOrganizacion(prisma, { id, motivo: `superadmin.${tipo}`, decidir });
    if (invalidar) for (const membresiaId of resultado.membresiaIds) sesiones.invalidarMembresia(membresiaId);
    if (resultado.cambio) {
      await auditar(
        prisma,
        {
          tipo,
          usuarioId,
          organizacionAfectadaId: id,
          ip: ipCliente(req, res),
          datos: { estadoNuevo: resultado.org.estadoVerificacion, miembrosAfectados: resultado.membresiaIds.length },
        },
        req.log,
      );
    }
    res.json(resultado.org);
  }

  return ({ registro, router }) => {
    registro.definir(router, { metodo: 'get', ruta: RUTA, acceso: 'PLATAFORMA' }, async (req, res) => {
      const { estado } = listarQuerySchema.parse(req.query);
      const organizaciones = await ejecutarComoPlataforma('superadmin.listar', () =>
        prisma.organizacion.findMany({
          where: estado ? { estadoVerificacion: estado } : {},
          orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            nombre: true,
            slug: true,
            estadoVerificacion: true,
            creadoEn: true,
            _count: { select: { membresias: true } },
          },
        }),
      );
      res.json(organizaciones.map(({ _count, ...org }) => ({ ...org, miembros: _count.membresias })));
    });

    registro.definir(router, { metodo: 'post', ruta: `${RUTA}/:id/verificar`, acceso: 'PLATAFORMA' }, async (req, res) => {
      const { usuarioId } = obtenerSesion(res);
      idDeParams(req.params);
      const { dominioCorreoVerificado } = verificarCuerpoSchema.parse(req.body ?? {});
      await accion(req, res, {
        tipo: 'VERIFICACION_ORG',
        invalidar: false,
        decidir: (actual) => {
          if (actual.estadoVerificacion === 'SUSPENDIDA') throw new AppError('VERSION_CONFLICT', SUSPENDIDA);
          // Ya verificada: no se reescribe quién ni cuándo; solo puede completarse el dato de dominio.
          if (actual.estadoVerificacion === 'VERIFICADA') {
            return dominioCorreoVerificado === undefined ? null : { dominioCorreoVerificado };
          }
          return {
            estadoVerificacion: 'VERIFICADA',
            verificadaPorId: usuarioId,
            verificadaEn: new Date(),
            ...(dominioCorreoVerificado === undefined ? {} : { dominioCorreoVerificado }),
          };
        },
      });
    });

    registro.definir(router, { metodo: 'post', ruta: `${RUTA}/:id/suspender`, acceso: 'PLATAFORMA' }, async (req, res) => {
      await accion(req, res, {
        tipo: 'SUSPENSION_ORG',
        // Siempre: aunque ya estuviera suspendida, ninguna membresía de la empresa debe seguir vigente en la caché.
        invalidar: true,
        decidir: (actual) => (actual.estadoVerificacion === 'SUSPENDIDA' ? null : { estadoVerificacion: 'SUSPENDIDA' }),
      });
    });

    registro.definir(router, { metodo: 'post', ruta: `${RUTA}/:id/reactivar`, acceso: 'PLATAFORMA' }, async (req, res) => {
      await accion(req, res, {
        tipo: 'REACTIVACION_ORG',
        // Para que los miembros recuperen la empresa sin esperar a que venza la caché.
        invalidar: true,
        decidir: (actual) => {
          if (actual.estadoVerificacion !== 'SUSPENDIDA') return null;
          return { estadoVerificacion: actual.verificadaEn ? 'VERIFICADA' : 'PENDIENTE' };
        },
      });
    });
  };
}
