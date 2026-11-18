import { randomUUID } from 'node:crypto';
import { crearInvitacionSchema } from '@criterio/shared';
import { z } from 'zod';
import type { Modulo } from '../../app';
import { auditar } from '../../auditoria';
import { generarToken } from '../../auth/tokens-aleatorios';
import { ipCliente } from '../../http/edge';
import { AppError } from '../../http/errores';
import type { EscenarioAislamiento } from '../../http/registro';
import { obtenerSesionEmpresa } from '../../http/sesion';
import { ejecutarComoPlataforma } from '../../tenant/contexto';
import type { DependenciasModulos } from '..';
import { enTransaccionSerializable } from '../organizaciones/comun';

const RUTA = '/api/organizacion/invitaciones';
const ROLES_GESTION = ['OWNER', 'ADMIN'] as const;
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const paramsSchema = z.object({ id: z.uuid() });

const NO_ENCONTRADA = 'No encontrado';
const SOLO_OWNER = 'Solo un OWNER puede invitar a otro OWNER';
const YA_MIEMBRO = 'Esa persona ya es miembro de la empresa';
const YA_ACEPTADA = 'La invitación ya fue aceptada; gestiona a esa persona desde el equipo';

/** Invitación pendiente ficticia en la empresa del escenario (cliente sin filtro, solo en la suite). */
function invitacionDePrueba({ organizacionId, prisma }: Parameters<EscenarioAislamiento['preparar']>[0]) {
  return prisma.invitacion.create({
    data: {
      organizacionId,
      email: `aislamiento-${randomUUID()}@ejemplo.test`,
      rol: 'RECLUTADOR',
      tokenHash: generarToken().hash,
      expiraEn: new Date(Date.now() + SIETE_DIAS_MS),
      creadaPorId: randomUUID(),
    },
  });
}

/** Crear, listar (pendientes) y revocar invitaciones de la empresa activa. Solo OWNER y ADMIN. */
export function rutasGestionInvitaciones({ prisma, seguridad }: DependenciasModulos): Modulo {
  return ({ registro, router }) => {
    registro.definir(
      router,
      {
        metodo: 'post',
        ruta: RUTA,
        acceso: 'TENANT',
        roles: ROLES_GESTION,
        // La respuesta de la dueña lleva su organizacionId; la de otra empresa crea en la suya y no debe llevarlo.
        aislamiento: {
          preparar: async ({ organizacionId }) => ({
            tipo: 'COLECCION',
            ruta: RUTA,
            marcador: organizacionId,
            cuerpo: { email: `aislamiento-${randomUUID()}@ejemplo.test`, rol: 'RECLUTADOR' },
          }),
        },
      },
      async (req, res) => {
        const sesion = obtenerSesionEmpresa(res);
        const datos = crearInvitacionSchema.parse(req.body);
        // El rol de quien invita se lee de la base (contexto de empresa), no solo del token.
        const actor = await prisma.membresia.findUnique({ where: { id: sesion.membresiaId }, select: { rol: true } });
        // El rol se relee de la base: la sesión en caché puede tener hasta 60 s de antigüedad.
        if (!actor || !(ROLES_GESTION as readonly string[]).includes(actor.rol)) {
          throw new AppError('FORBIDDEN', 'No tienes permiso para invitar en esta empresa');
        }
        if (datos.rol === 'OWNER' && actor.rol !== 'OWNER') throw new AppError('FORBIDDEN', SOLO_OWNER);
        // En contexto de empresa, Usuario solo ve a los miembros de esta empresa: si aparece, ya es miembro.
        const miembro = await prisma.usuario.findFirst({ where: { email: datos.email }, select: { id: true } });
        if (miembro) throw new AppError('DUPLICATE', YA_MIEMBRO);

        const { token, hash } = generarToken();
        const expiraEn = new Date(Date.now() + SIETE_DIAS_MS);
        // tokenHash es un campo secreto: la guardia lo rechaza en cualquier consulta fuera del modo plataforma, también
        // en `data`. Por eso esta única inserción va en modo plataforma, con el organizacionId EXPLÍCITO de la sesión
        // ya resuelta (membresía vigente en esa empresa), que es el mismo que pondría el filtro multiempresa.
        const invitacion = await ejecutarComoPlataforma('invitaciones.crear', () =>
          prisma.invitacion.create({
            data: {
              organizacionId: sesion.organizacionId,
              email: datos.email,
              rol: datos.rol,
              tokenHash: hash,
              expiraEn,
              creadaPorId: sesion.usuarioId,
            },
            select: { id: true, organizacionId: true, email: true, rol: true, expiraEn: true },
          }),
        );

        await auditar(
          prisma,
          {
            tipo: 'INVITACION_CREADA',
            usuarioId: sesion.usuarioId,
            organizacionAfectadaId: sesion.organizacionId,
            ip: ipCliente(req, res),
            datos: { invitacionId: invitacion.id, rolInvitado: invitacion.rol },
          },
          req.log,
        );
        // El token en claro sale solo aquí, dentro del enlace; en la base queda su hash.
        res.status(201).json({ ...invitacion, enlace: `${seguridad.webOrigin}/invitacion/${token}` });
      },
    );

    registro.definir(
      router,
      {
        metodo: 'get',
        ruta: RUTA,
        acceso: 'TENANT',
        roles: ROLES_GESTION,
        aislamiento: {
          preparar: async (ctx) => ({ tipo: 'COLECCION', ruta: RUTA, marcador: (await invitacionDePrueba(ctx)).id }),
        },
      },
      async (_req, res) => {
        // tokenHash nunca sale: omit global del cliente y un select que no lo nombra.
        const invitaciones = await prisma.invitacion.findMany({
          where: { aceptadaEn: null, revocadaEn: null, expiraEn: { gt: new Date() } },
          orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
          select: { id: true, email: true, rol: true, expiraEn: true, creadoEn: true },
        });
        res.json(invitaciones);
      },
    );

    registro.definir(
      router,
      {
        metodo: 'delete',
        ruta: `${RUTA}/:id`,
        acceso: 'TENANT',
        roles: ROLES_GESTION,
        aislamiento: {
          preparar: async (ctx) => ({ tipo: 'RECURSO', ruta: `${RUTA}/${(await invitacionDePrueba(ctx)).id}` }),
        },
      },
      async (req, res) => {
        const sesion = obtenerSesionEmpresa(res);
        const params = paramsSchema.safeParse(req.params);
        if (!params.success) throw new AppError('NOT_FOUND', NO_ENCONTRADA);
        const { id } = params.data;
        // Leer y marcar en la misma transacción: una aceptación simultánea no queda "revocada" después de aceptada.
        // Devuelve el id canónico (el de la base) si la revocó ahora, o null si ya estaba revocada (idempotente).
        const revocada = await enTransaccionSerializable(prisma, async (tx) => {
          const invitacion = await tx.invitacion.findUnique({
            where: { id },
            select: { id: true, aceptadaEn: true, revocadaEn: true },
          });
          if (!invitacion) throw new AppError('NOT_FOUND', NO_ENCONTRADA);
          if (invitacion.aceptadaEn) throw new AppError('HAS_DEPENDENCIES', YA_ACEPTADA);
          if (invitacion.revocadaEn) return null;
          await tx.invitacion.update({ where: { id }, data: { revocadaEn: new Date() }, select: { id: true } });
          return invitacion.id;
        });
        if (revocada) {
          await auditar(
            prisma,
            {
              tipo: 'INVITACION_REVOCADA',
              usuarioId: sesion.usuarioId,
              organizacionAfectadaId: sesion.organizacionId,
              ip: ipCliente(req, res),
              datos: { invitacionId: revocada },
            },
            req.log,
          );
        }
        res.status(204).end();
      },
    );
  };
}
