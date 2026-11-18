import type { PrismaBase } from '../db/prisma';
import { asignarOrganizacion } from './asignar-organizacion';
import { contextoActual } from './contexto';
import { protegerModeloGlobal } from './globales';
import { agregarRestriccion } from './restriccion';
import {
  esModeloTenant,
  MODELOS_TENANT,
  SinContextoTenantError,
  verificarRelaciones,
  ViolacionMultiempresaError,
} from './relaciones';
import { rechazarCamposSecretos } from './secretos';

export { MODELOS_TENANT, SinContextoTenantError, ViolacionMultiempresaError };

const OPERACIONES_CON_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

const OPERACIONES_DE_CREACION = new Set(['create', 'createMany', 'createManyAndReturn']);

function impedirCambioDeOrganizacion(datos: unknown): void {
  if (datos && typeof datos === 'object' && 'organizacionId' in datos) {
    throw new ViolacionMultiempresaError('No se puede cambiar organizacionId');
  }
}

export function extenderConTenant(prisma: PrismaBase) {
  return prisma.$extends({
    name: 'multiempresa',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const contexto = contextoActual();
          if (contexto?.modo === 'plataforma') return query(args);
          // Antes que cualquier otra regla y para todos los modelos: ni leer, ni filtrar, ni ordenar por un secreto.
          rechazarCamposSecretos(args);

          const a = { ...(args as Record<string, unknown>) };

          if (!esModeloTenant(model)) {
            try {
              verificarRelaciones(model, a);
            } catch (error) {
              if (!contexto && error instanceof ViolacionMultiempresaError) {
                throw new SinContextoTenantError(model, operation);
              }
              throw error;
            }
            const contextoEmpresa = contexto?.modo === 'tenant' ? contexto : undefined;
            return query(protegerModeloGlobal(model, operation, a, contextoEmpresa) as typeof args);
          }

          if (!contexto) throw new SinContextoTenantError(model, operation);
          const conocida = OPERACIONES_CON_WHERE.has(operation) || OPERACIONES_DE_CREACION.has(operation);
          if (!conocida) throw new ViolacionMultiempresaError(`Operación ${model}.${operation} no soportada en modelos multiempresa`);

          verificarRelaciones(model, a);
          const { organizacionId } = contexto;

          if (OPERACIONES_CON_WHERE.has(operation)) {
            // AND, no sobrescritura: un organizacionId ajeno en el where deja de coincidir (no se redirige a la propia).
            a.where = agregarRestriccion(a.where, { organizacionId });
          }
          if (OPERACIONES_DE_CREACION.has(operation)) {
            a.data = asignarOrganizacion(a.data, organizacionId);
          }
          if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
            impedirCambioDeOrganizacion(a.data);
          }
          if (operation === 'upsert') {
            a.create = asignarOrganizacion(a.create, organizacionId);
            impedirCambioDeOrganizacion(a.update);
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type PrismaTenant = ReturnType<typeof extenderConTenant>;
