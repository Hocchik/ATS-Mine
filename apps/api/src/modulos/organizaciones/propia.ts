import { actualizarOrganizacionSchema } from '@criterio/shared';
import type { Modulo } from '../../app';
import type { EscenarioAislamiento } from '../../http/registro';
import { AppError } from '../../http/errores';
import { obtenerSesionEmpresa } from '../../http/sesion';
import type { DependenciasModulos } from '..';
import { cambiarSlug, enTransaccionSerializable, SELECT_ORGANIZACION } from './comun';

const NO_ENCONTRADA = 'No encontrado';
const RUTA = '/api/organizacion';

/** La respuesta de la dueña incluye su id; la de otra empresa (que ve la suya) no debe incluirlo. */
const escenarioPropia = (cuerpo?: object): EscenarioAislamiento => ({
  preparar: async ({ organizacionId }) => ({
    tipo: 'COLECCION',
    ruta: RUTA,
    marcador: organizacionId,
    ...(cuerpo ? { cuerpo } : {}),
  }),
});

/** GET y PUT de la empresa activa. En contexto de empresa, el filtro solo deja ver y editar la propia. */
export function rutasOrganizacionPropia({ prisma }: DependenciasModulos): Modulo {
  return ({ registro, router }) => {
    registro.definir(
      router,
      { metodo: 'get', ruta: RUTA, acceso: 'TENANT', aislamiento: escenarioPropia() },
      async (_req, res) => {
        const { organizacionId } = obtenerSesionEmpresa(res);
        const organizacion = await prisma.organizacion.findUnique({
          where: { id: organizacionId },
          select: SELECT_ORGANIZACION,
        });
        if (!organizacion) throw new AppError('NOT_FOUND', NO_ENCONTRADA);
        res.json({ organizacion });
      },
    );

    registro.definir(
      router,
      {
        metodo: 'put',
        ruta: RUTA,
        acceso: 'TENANT',
        roles: ['OWNER', 'ADMIN'],
        aislamiento: escenarioPropia({ nombre: 'X' }),
      },
      async (req, res) => {
        const { organizacionId } = obtenerSesionEmpresa(res);
        // .strict(): un campo fuera de la lista (esDemo, estadoVerificacion…) es 400 antes de llegar a la guardia.
        const datos = actualizarOrganizacionSchema.parse(req.body);
        const organizacion = await enTransaccionSerializable(prisma, async (tx) => {
          const actual = await tx.organizacion.findUnique({ where: { id: organizacionId }, select: { slug: true } });
          if (!actual) throw new AppError('NOT_FOUND', NO_ENCONTRADA);
          if (datos.slug !== undefined && datos.slug !== actual.slug) {
            await cambiarSlug(tx, { organizacionId, slugActual: actual.slug, slugNuevo: datos.slug });
          }
          return tx.organizacion.update({ where: { id: organizacionId }, data: datos, select: SELECT_ORGANIZACION });
        });
        res.json({ organizacion });
      },
    );
  };
}
