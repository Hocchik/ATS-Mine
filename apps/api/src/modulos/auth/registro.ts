import { registroSchema } from '@criterio/shared';
import { Prisma } from '@prisma/client';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { hashearContrasena } from '../../auth/contrasenas';
import { ipCliente } from '../../http/edge';
import { AppError } from '../../http/errores';
import { crearLimitador } from '../../http/limites';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { emitirSesionFirmada } from './comun';

/** Genérico a propósito: no confirma si el email ya tiene cuenta más allá de lo inevitable (409). */
const MENSAJE_DUPLICADO = 'No se pudo crear la cuenta con esos datos';

const esDuplicado = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export function rutasRegistro({ prisma, seguridad }: DependenciasModulos): Modulo {
  const limitePorIp = crearLimitador({ ventanaMs: 3600_000, maximo: 10 });

  return ({ registro, router }) => {
    registro.definir(
      router,
      { metodo: 'post', ruta: '/api/auth/registro', acceso: 'PUBLICA' },
      limitePorIp,
      async (req, res) => {
        const datos = registroSchema.parse(req.body);
        // El hash va antes de crear: el camino del email duplicado cuesta lo mismo que el exitoso.
        const passwordHash = await hashearContrasena(datos.contrasena);
        let usuario: { id: string; nombre: string; email: string; versionSesion: number };
        try {
          usuario = await ejecutarComoPlataforma('auth.registro', () =>
            prisma.usuario.create({
              data: { nombre: datos.nombre, email: datos.email, passwordHash },
              select: { id: true, nombre: true, email: true, versionSesion: true },
            }),
          );
        } catch (err) {
          if (esDuplicado(err)) throw new AppError('DUPLICATE', MENSAJE_DUPLICADO);
          throw err;
        }

        await emitirSesionFirmada(res, seguridad, { usuarioId: usuario.id, versionSesion: usuario.versionSesion });
        await auditar(prisma, { tipo: 'REGISTRO', usuarioId: usuario.id, ip: ipCliente(req, res) }, req.log);
        res.status(201).json({ usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email } });
      },
    );
  };
}
