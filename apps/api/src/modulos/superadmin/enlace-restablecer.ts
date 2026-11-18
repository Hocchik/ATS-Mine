import { AppError } from '../../http/errores';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { generarToken } from '../../auth/tokens-aleatorios';
import { ipCliente } from '../../http/edge';
import { obtenerSesion } from '../../http/sesion';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { idDeParams, noEncontrado } from './comun';

const UNA_HORA_MS = 60 * 60_000;

/**
 * El superadmin genera un enlace de un solo uso (1 h) para que una persona restablezca su contraseña. En esta fase
 * es la única vía: un ADMIN de empresa no puede, porque podría tomar la cuenta de alguien con otras empresas.
 */
export function rutasEnlaceRestablecer({ prisma, seguridad }: DependenciasModulos): Modulo {
  return ({ registro, router }) => {
    registro.definir(
      router,
      { metodo: 'post', ruta: '/api/superadmin/usuarios/:id/enlace-restablecer', acceso: 'PLATAFORMA' },
      async (req, res) => {
        const sesion = obtenerSesion(res);
        const usuarioId = idDeParams(req.params);
        const { token, hash } = generarToken();
        const expiraEn = new Date(Date.now() + UNA_HORA_MS);

        // TokenRestablecer es solo de plataforma y tokenHash es secreto: todo en modo plataforma.
        const creado = await ejecutarComoPlataforma('superadmin.enlace-restablecer', () =>
          prisma.$transaction(async (tx) => {
            const usuario = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, esSuperadmin: true } });
            if (!usuario) throw noEncontrado();
            // Un superadmin comprometido no debe poder tomar otras cuentas superadmin (ni rotar la propia por aquí).
            if (usuario.esSuperadmin) {
              throw new AppError('FORBIDDEN', 'Las cuentas superadmin se restablecen con el seed, no con enlaces');
            }
            // Un enlace nuevo deja vencidos los anteriores pendientes: solo el último sirve.
            const ahora = new Date();
            await tx.tokenRestablecer.updateMany({
              where: { usuarioId, usadoEn: null, expiraEn: { gt: ahora } },
              data: { expiraEn: ahora },
            });
            return tx.tokenRestablecer.create({
              data: { usuarioId, tokenHash: hash, expiraEn },
              select: { id: true, expiraEn: true },
            });
          }),
        );

        await auditar(
          prisma,
          {
            tipo: 'RESTABLECER_GENERADO',
            usuarioId: sesion.usuarioId,
            ip: ipCliente(req, res),
            datos: { usuarioAfectadoId: usuarioId, restablecimientoId: creado.id },
          },
          req.log,
        );
        // El token en claro sale solo aquí, dentro del enlace; en la base queda su hash.
        res.status(201).json({ enlace: `${seguridad.webOrigin}/restablecer/${token}`, expiraEn: creado.expiraEn });
      },
    );
  };
}
