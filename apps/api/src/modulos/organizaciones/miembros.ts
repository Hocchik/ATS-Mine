import { randomUUID } from 'node:crypto';
import { cambiarRolSchema } from '@criterio/shared';
import type { Rol } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { ipCliente } from '../../http/edge';
import type { EscenarioAislamiento } from '../../http/registro';
import { obtenerSesionEmpresa } from '../../http/sesion';
import type { DependenciasModulos } from '..';
import { emitirSesionFirmada, versionSesionVigente } from '../auth/comun';
import { enTransaccionSerializable } from './comun';
import { aplicarCambioDeMiembro, SELECT_MIEMBRO, type Miembro } from './reglas-miembros';

const RUTA = '/api/organizacion/miembros';
const RUTA_MIEMBRO = `${RUTA}/:membresiaId`;
const paramsSchema = z.object({ membresiaId: z.uuid() });

/** Persona y membresía RECLUTADOR ficticias en la empresa del escenario (cliente sin filtro, solo en la suite). */
async function membresiaDePrueba({ organizacionId, prisma }: Parameters<EscenarioAislamiento['preparar']>[0]) {
  const usuario = await prisma.usuario.create({
    data: { email: `aislamiento-${randomUUID()}@ejemplo.test`, nombre: 'Persona ficticia', passwordHash: 'no-usar' },
  });
  return prisma.membresia.create({ data: { usuarioId: usuario.id, organizacionId, rol: 'RECLUTADOR' } });
}

const aMiembro = (m: Miembro) => ({ membresiaId: m.id, usuario: m.usuario, rol: m.rol, creadoEn: m.creadoEn });

export function rutasMiembros({ prisma, sesiones, seguridad }: DependenciasModulos): Modulo {
  /** Corre el cambio en una transacción; invalida la caché DESPUÉS del commit y audita. */
  async function cambiar(req: Request, res: Response, rolNuevo: Rol | null) {
    const sesion = obtenerSesionEmpresa(res);
    const { membresiaId } = paramsSchema.parse(req.params);
    const resultado = await enTransaccionSerializable(prisma, (tx) =>
      aplicarCambioDeMiembro(tx, { actorMembresiaId: sesion.membresiaId, membresiaId, rolNuevo }),
    );
    if (resultado.cambio) {
      sesiones.invalidarMembresia(resultado.membresiaId);
      await auditar(
        prisma,
        {
          tipo: rolNuevo ? 'CAMBIO_ROL' : 'MIEMBRO_ELIMINADO',
          usuarioId: sesion.usuarioId,
          organizacionAfectadaId: sesion.organizacionId,
          ip: ipCliente(req, res),
          datos: {
            membresiaId: resultado.membresiaId,
            usuarioAfectadoId: resultado.usuarioId,
            rolAnterior: resultado.rolAnterior,
            ...(rolNuevo ? { rolNuevo } : {}),
          },
        },
        req.log,
      );
    }
    return { sesion, resultado };
  }

  return ({ registro, router }) => {
    registro.definir(
      router,
      {
        metodo: 'get',
        ruta: RUTA,
        acceso: 'TENANT',
        aislamiento: {
          preparar: async (ctx) => ({ tipo: 'COLECCION', ruta: RUTA, marcador: (await membresiaDePrueba(ctx)).id }),
        },
      },
      async (_req, res) => {
        const miembros = await prisma.membresia.findMany({
          orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
          select: SELECT_MIEMBRO,
        });
        res.json(miembros.map(aMiembro));
      },
    );

    registro.definir(
      router,
      {
        metodo: 'patch',
        ruta: RUTA_MIEMBRO,
        acceso: 'TENANT',
        roles: ['OWNER', 'ADMIN'],
        aislamiento: {
          preparar: async (ctx) => ({
            tipo: 'RECURSO',
            ruta: `${RUTA}/${(await membresiaDePrueba(ctx)).id}`,
            cuerpo: { rol: 'ENTREVISTADOR' },
          }),
        },
      },
      async (req, res) => {
        const { rol } = cambiarRolSchema.parse(req.body);
        const { sesion, resultado } = await cambiar(req, res, rol);
        const { miembro } = resultado;
        if (!miembro) throw new Error('Un cambio de rol siempre devuelve la membresía');
        // Quien cambia su propio rol invalidó su token: se le emite uno con la versión nueva.
        if (resultado.cambio && miembro.id === sesion.membresiaId) {
          const versionSesion = await versionSesionVigente(
            req,
            { prisma, seguridad, motivo: 'organizaciones.miembros' },
            sesion.usuarioId,
          );
          await emitirSesionFirmada(res, seguridad, {
            usuarioId: sesion.usuarioId,
            versionSesion,
            empresa: {
              organizacionId: sesion.organizacionId,
              membresiaId: sesion.membresiaId,
              versionMembresia: miembro.version,
            },
          });
        }
        res.json(aMiembro(miembro));
      },
    );

    registro.definir(
      router,
      {
        metodo: 'delete',
        ruta: RUTA_MIEMBRO,
        acceso: 'TENANT',
        roles: ['OWNER', 'ADMIN'],
        aislamiento: {
          preparar: async (ctx) => ({ tipo: 'RECURSO', ruta: `${RUTA}/${(await membresiaDePrueba(ctx)).id}` }),
        },
      },
      async (req, res) => {
        await cambiar(req, res, null);
        res.status(204).end();
      },
    );
  };
}
