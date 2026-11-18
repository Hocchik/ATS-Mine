import { Prisma } from '@prisma/client';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { ipCliente } from '../../http/edge';
import { AppError } from '../../http/errores';
import { crearLimitador } from '../../http/limites';
import { obtenerSesion } from '../../http/sesion';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { emitirSesionFirmada, versionSesionVigente, type EmpresaActivaRespuesta } from '../auth/comun';
import { enTransaccionSerializable } from '../organizaciones/comun';
import { invitacionVigente, mismoEmail, tokenDeParams, tokenInvalido } from './comun';

const MOTIVO_CONSULTAR = 'invitaciones.consultar';
const MOTIVO_ACEPTAR = 'invitaciones.aceptar';
const QUINCE_MINUTOS = 15 * 60_000;
const YA_MIEMBRO = 'Ya eres miembro de esta empresa';

const esDuplicado = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Consulta pública del enlace y aceptación. Las búsquedas por token usan `tokenHash` (campo secreto), así que corren
 * en modo plataforma; la invitación aún no pertenece a ninguna empresa de quien la abre.
 */
export function rutasAceptarInvitacion({ prisma, seguridad }: DependenciasModulos): Modulo {
  const limitePorIp = crearLimitador({ ventanaMs: QUINCE_MINUTOS, maximo: 30 });

  return ({ registro, router }) => {
    registro.definir(
      router,
      { metodo: 'get', ruta: '/public/invitaciones/:token', acceso: 'PUBLICA' },
      limitePorIp,
      async (req, res) => {
        const token = tokenDeParams(req.params);
        const invitacion = await ejecutarComoPlataforma(MOTIVO_CONSULTAR, () => invitacionVigente(prisma, token));
        res.json({ organizacion: { nombre: invitacion.organizacion.nombre }, email: invitacion.email, rol: invitacion.rol });
      },
    );

    registro.definir(
      router,
      {
        metodo: 'post',
        ruta: '/api/invitaciones/:token/aceptar',
        acceso: 'AUTENTICADA',
        aislamiento: {
          noAplica:
            'solo une a la propia persona a la empresa del token, si su email coincide; no lee ni expone otras empresas',
        },
      },
      async (req, res) => {
        const { usuarioId } = obtenerSesion(res);
        const token = tokenDeParams(req.params);
        // Antes de escribir: un token de sesión ya invalidado no debe dejar una membresía creada y luego responder 401.
        const versionSesion = await versionSesionVigente(req, { prisma, seguridad, motivo: MOTIVO_ACEPTAR }, usuarioId);

        const { invitacion, membresia } = await ejecutarComoPlataforma(MOTIVO_ACEPTAR, async () => {
          try {
            return await enTransaccionSerializable(prisma, async (tx) => {
              const invitacion = await invitacionVigente(tx, token);
              const usuario = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { email: true } });
              if (!usuario || !mismoEmail(usuario.email, invitacion.email)) throw tokenInvalido();
              const existente = await tx.membresia.findUnique({
                where: { usuarioId_organizacionId: { usuarioId, organizacionId: invitacion.organizacionId } },
                select: { id: true },
              });
              if (existente) throw new AppError('DUPLICATE', YA_MIEMBRO);
              // Marca condicionada: si otra petición la aceptó o revocó entretanto, no se usa dos veces.
              const marcada = await tx.invitacion.updateMany({
                where: { id: invitacion.id, aceptadaEn: null, revocadaEn: null },
                data: { aceptadaEn: new Date() },
              });
              if (marcada.count !== 1) throw tokenInvalido();
              const membresia = await tx.membresia.create({
                data: { organizacionId: invitacion.organizacionId, usuarioId, rol: invitacion.rol },
                select: { id: true, version: true },
              });
              return { invitacion, membresia };
            });
          } catch (err) {
            if (esDuplicado(err)) throw new AppError('DUPLICATE', YA_MIEMBRO);
            throw err;
          }
        });

        await emitirSesionFirmada(res, seguridad, {
          usuarioId,
          versionSesion,
          empresa: {
            organizacionId: invitacion.organizacionId,
            membresiaId: membresia.id,
            versionMembresia: membresia.version,
          },
        });
        await auditar(
          prisma,
          {
            tipo: 'INVITACION_ACEPTADA',
            usuarioId,
            organizacionAfectadaId: invitacion.organizacionId,
            ip: ipCliente(req, res),
            datos: { invitacionId: invitacion.id, rolInvitado: invitacion.rol },
          },
          req.log,
        );
        const empresaActiva: EmpresaActivaRespuesta = {
          organizacionId: invitacion.organizacionId,
          nombre: invitacion.organizacion.nombre,
          slug: invitacion.organizacion.slug,
          rol: invitacion.rol,
        };
        res.json({ empresaActiva });
      },
    );
  };
}
