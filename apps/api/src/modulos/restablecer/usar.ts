import { contrasenaSchema } from '@criterio/shared';
import { z } from 'zod';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { hashearContrasena } from '../../auth/contrasenas';
import { hashToken } from '../../auth/tokens-aleatorios';
import { ipCliente } from '../../http/edge';
import { AppError } from '../../http/errores';
import { crearLimitador } from '../../http/limites';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { PrismaTenant } from '../../tenant/extension';
import type { DependenciasModulos } from '..';

const MOTIVO = 'restablecer.usar';
const QUINCE_MINUTOS = 15 * 60_000;
/** generarToken(): 32 bytes en base64url, sin relleno → exactamente 43 caracteres. */
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** Un solo mensaje para inexistente, mal formado, vencido o ya usado: no revela cuál. */
const MENSAJE_TOKEN = 'El enlace para restablecer la contraseña no es válido o ya no está disponible';
const cuerpoSchema = z.object({ token: z.unknown(), contrasena: contrasenaSchema });

const tokenInvalido = () => new AppError('TOKEN_INVALIDO', MENSAJE_TOKEN);

/** Token pendiente (sin usar, no vencido) con ese hash, o TOKEN_INVALIDO. tokenHash es secreto: modo plataforma. */
async function tokenPendiente(cliente: Pick<PrismaTenant, 'tokenRestablecer'>, tokenHash: string, ahora: Date) {
  const fila = await cliente.tokenRestablecer.findUnique({
    where: { tokenHash },
    select: { id: true, usuarioId: true, usadoEn: true, expiraEn: true },
  });
  if (!fila || fila.usadoEn !== null || fila.expiraEn.getTime() <= ahora.getTime()) throw tokenInvalido();
  return fila;
}

/** POST /public/restablecer: con el token del enlace, fija una contraseña nueva y cierra todas las sesiones. */
export function rutasUsarRestablecer({ prisma, sesiones }: DependenciasModulos): Modulo {
  const limitePorIp = crearLimitador({ ventanaMs: QUINCE_MINUTOS, maximo: 10 });

  return ({ registro, router }) => {
    registro.definir(
      router,
      { metodo: 'post', ruta: '/public/restablecer', acceso: 'PUBLICA' },
      limitePorIp,
      async (req, res) => {
        const { token, contrasena } = cuerpoSchema.parse(req.body ?? {});
        if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) throw tokenInvalido();
        const tokenHash = hashToken(token);
        // Comprobación previa barata: un token que no sirve no paga el costo de bcrypt.
        await ejecutarComoPlataforma(MOTIVO, () => tokenPendiente(prisma, tokenHash, new Date()));
        // El hash se calcula fuera de la transacción para no tenerla abierta durante bcrypt.
        const passwordHash = await hashearContrasena(contrasena);

        const usuarioId = await ejecutarComoPlataforma(MOTIVO, () =>
          prisma.$transaction(async (tx) => {
            const ahora = new Date();
            const fila = await tokenPendiente(tx, tokenHash, ahora);
            // Marca condicionada: si otra petición lo usó entretanto, esta no lo vuelve a usar.
            const marcado = await tx.tokenRestablecer.updateMany({
              where: { id: fila.id, usadoEn: null, expiraEn: { gt: ahora } },
              data: { usadoEn: ahora },
            });
            if (marcado.count !== 1) throw tokenInvalido();
            // Cualquier otro enlace pendiente de la persona deja de servir.
            await tx.tokenRestablecer.updateMany({
              where: { usuarioId: fila.usuarioId, usadoEn: null, expiraEn: { gt: ahora } },
              data: { expiraEn: ahora },
            });
            // versionSesion sube: todos los tokens de sesión anteriores de la persona quedan inválidos.
            await tx.usuario.update({
              where: { id: fila.usuarioId },
              data: { passwordHash, versionSesion: { increment: 1 } },
              select: { id: true },
            });
            return fila.usuarioId;
          }),
        );

        // Después del commit: invalidar dentro de la transacción dejaría re-cachear la fila previa.
        sesiones.invalidarUsuario(usuarioId);
        await auditar(prisma, { tipo: 'RESTABLECER_USADO', usuarioId, ip: ipCliente(req, res) }, req.log);
        res.status(204).end();
      },
    );
  };
}
