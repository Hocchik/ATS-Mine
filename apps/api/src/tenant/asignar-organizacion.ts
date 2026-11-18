import { ViolacionMultiempresaError } from './relaciones';

/**
 * Prepara el `data` de un create (o el `create` de un upsert) sobre un modelo multiempresa
 * para que la fila quede en la empresa del contexto activo. Devuelve una copia; nunca muta la entrada.
 *
 * Política: un organizacionId distinto al del contexto se RECHAZA, no se corrige en silencio.
 * Es un error de programación y debe verse (principio "ante la duda, fallar de forma visible").
 * Se exige organizacionId escalar: `organizacion: { connect }` también se rechaza.
 */
export function asignarOrganizacion(datos: unknown, organizacionId: string): unknown {
  if (Array.isArray(datos)) return datos.map((d) => asignarOrganizacion(d, organizacionId));
  const registro = { ...((datos ?? {}) as Record<string, unknown>) };
  if ('organizacion' in registro) {
    throw new ViolacionMultiempresaError('En modelos multiempresa usa organizacionId escalar, no connect a organizacion');
  }
  if (registro.organizacionId !== undefined && registro.organizacionId !== organizacionId) {
    throw new ViolacionMultiempresaError('organizacionId no coincide con el contexto de empresa');
  }
  registro.organizacionId = organizacionId;
  return registro;
}
