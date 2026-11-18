import { crearOrganizacionSchema } from '@criterio/shared';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { ipCliente } from '../../http/edge';
import { crearLimitador } from '../../http/limites';
import { obtenerSesion } from '../../http/sesion';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { emitirSesionFirmada, versionSesionVigente, type EmpresaActivaRespuesta } from '../auth/comun';
import { enTransaccionSerializable, exigirSlugLibre, SELECT_ORGANIZACION } from './comun';

const MOTIVO = 'organizaciones.crear';
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** POST /api/organizaciones: la persona autenticada crea una empresa (PENDIENTE) y queda como su OWNER. */
export function rutaCrearOrganizacion({ prisma, seguridad }: DependenciasModulos): Modulo {
  // Va después del guard de sesión (definir pone los guards antes de los handlers): la clave es la persona.
  const limitePorPersona = crearLimitador({
    ventanaMs: UN_DIA_MS,
    maximo: 5,
    clave: (_req, res) => `org:${obtenerSesion(res).usuarioId}`,
  });

  return ({ registro, router }) => {
    registro.definir(
      router,
      {
        metodo: 'post',
        ruta: '/api/organizaciones',
        acceso: 'AUTENTICADA',
        aislamiento: { noAplica: 'crea una empresa nueva para la propia persona; no lee ni expone empresas existentes' },
      },
      limitePorPersona,
      async (req, res) => {
        const { usuarioId } = obtenerSesion(res);
        const datos = crearOrganizacionSchema.parse(req.body);
        // Antes de crear: un token ya invalidado no debe dejar una empresa creada y luego responder 401.
        const versionSesion = await versionSesionVigente(req, { prisma, seguridad, motivo: MOTIVO }, usuarioId);

        // Todo en modo plataforma (aún no hay contexto de empresa) y en una sola transacción.
        const { organizacion, membresia } = await ejecutarComoPlataforma(MOTIVO, () =>
          enTransaccionSerializable(prisma, async (tx) => {
            await exigirSlugLibre(tx, datos.slug);
            const organizacion = await tx.organizacion.create({
              data: {
                nombre: datos.nombre,
                slug: datos.slug,
                zonaHoraria: datos.zonaHoraria,
                locale: datos.locale,
                pais: datos.pais,
              },
              select: SELECT_ORGANIZACION,
            });
            const membresia = await tx.membresia.create({
              data: { organizacionId: organizacion.id, usuarioId, rol: 'OWNER' },
              select: { id: true, version: true },
            });
            return { organizacion, membresia };
          }),
        );

        await emitirSesionFirmada(res, seguridad, {
          usuarioId,
          versionSesion,
          empresa: { organizacionId: organizacion.id, membresiaId: membresia.id, versionMembresia: membresia.version },
        });
        await auditar(
          prisma,
          { tipo: 'ORGANIZACION_CREADA', usuarioId, organizacionAfectadaId: organizacion.id, ip: ipCliente(req, res) },
          req.log,
        );
        const empresaActiva: EmpresaActivaRespuesta = {
          organizacionId: organizacion.id,
          nombre: organizacion.nombre,
          slug: organizacion.slug,
          rol: 'OWNER',
        };
        res.status(201).json({ organizacion, empresaActiva });
      },
    );
  };
}
