import { loginSchema } from '@criterio/shared';
import type { Request } from 'express';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { verificarContrasena } from '../../auth/contrasenas';
import { hashToken } from '../../auth/tokens-aleatorios';
import { ipCliente } from '../../http/edge';
import { AppError } from '../../http/errores';
import { crearLimitador } from '../../http/limites';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { PrismaTenant } from '../../tenant/extension';
import type { DependenciasModulos } from '..';
import { emitirSesionFirmada, type EmpresaActivaRespuesta } from './comun';

const MOTIVO = 'auth.login';
/** Mismo mensaje para email inexistente y contraseña incorrecta: no revela qué emails tienen cuenta. */
const MENSAJE_CREDENCIALES = 'Email o contraseña incorrectos';
const QUINCE_MINUTOS = 15 * 60_000;

/** Clave del limitador por email: el hash del email normalizado, nunca el email en claro (vive en memoria). */
export function claveLimitePorEmail(req: Request): string {
  const datos = loginSchema.safeParse(req.body);
  return datos.success ? `email:${hashToken(datos.data.email)}` : 'invalido';
}

/** La membresía más reciente cuya empresa no esté suspendida, o null. */
async function empresaInicial(prisma: PrismaTenant, usuarioId: string) {
  const membresia = await ejecutarComoPlataforma(MOTIVO, () =>
    prisma.membresia.findFirst({
      where: { usuarioId, organizacion: { estadoVerificacion: { not: 'SUSPENDIDA' } } },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        organizacionId: true,
        rol: true,
        version: true,
        organizacion: { select: { nombre: true, slug: true } },
      },
    }),
  );
  if (!membresia) return null;
  const respuesta: EmpresaActivaRespuesta = {
    organizacionId: membresia.organizacionId,
    nombre: membresia.organizacion.nombre,
    slug: membresia.organizacion.slug,
    rol: membresia.rol,
  };
  return { membresia, respuesta };
}

export function rutasLogin({ prisma, seguridad }: DependenciasModulos): Modulo {
  const limitePorIp = crearLimitador({ ventanaMs: QUINCE_MINUTOS, maximo: 20 });
  const limitePorEmail = crearLimitador({ ventanaMs: QUINCE_MINUTOS, maximo: 10, clave: claveLimitePorEmail });

  return ({ registro, router }) => {
    registro.definir(
      router,
      { metodo: 'post', ruta: '/api/auth/login', acceso: 'PUBLICA' },
      limitePorIp,
      limitePorEmail,
      async (req, res) => {
        const { email, contrasena } = loginSchema.parse(req.body);
        const ip = ipCliente(req, res);
        const usuario = await ejecutarComoPlataforma(MOTIVO, () =>
          prisma.usuario.findUnique({ where: { email }, omit: { passwordHash: false } }),
        );
        // Siempre se verifica (con el señuelo si no hay usuario): mismo tiempo y mismo camino en ambos fallos.
        const valida = await verificarContrasena(contrasena, usuario?.passwordHash ?? null);
        if (!usuario || !valida) {
          await auditar(prisma, { tipo: 'LOGIN_FALLIDO', ...(usuario ? { usuarioId: usuario.id } : {}), ip }, req.log);
          throw new AppError('CREDENCIALES_INVALIDAS', MENSAJE_CREDENCIALES);
        }

        const empresa = await empresaInicial(prisma, usuario.id);
        await emitirSesionFirmada(res, seguridad, {
          usuarioId: usuario.id,
          versionSesion: usuario.versionSesion,
          ...(empresa
            ? {
                empresa: {
                  organizacionId: empresa.membresia.organizacionId,
                  membresiaId: empresa.membresia.id,
                  versionMembresia: empresa.membresia.version,
                },
              }
            : {}),
        });
        await auditar(
          prisma,
          {
            tipo: 'LOGIN',
            usuarioId: usuario.id,
            ...(empresa ? { organizacionAfectadaId: empresa.membresia.organizacionId } : {}),
            ip,
          },
          req.log,
        );
        res.json({
          usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, esSuperadmin: usuario.esSuperadmin },
          empresaActiva: empresa?.respuesta ?? null,
        });
      },
    );
  };
}
