import type { ContextoEmpresa } from './contexto';
import { SinContextoTenantError, ViolacionMultiempresaError } from './relaciones';
import { agregarRestriccion } from './restriccion';

const LECTURAS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const ACTUALIZACIONES = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/**
 * Lista blanca: los únicos campos de Organizacion que la propia empresa puede editar.
 * Todo lo demás (id, estado de verificación, esDemo, campos futuros) solo lo cambia la plataforma.
 */
export const CAMPOS_EDITABLES_ORGANIZACION: ReadonlySet<string> = new Set([
  'nombre',
  'slug',
  'logoClave',
  'colorAcento',
  'zonaHoraria',
  'locale',
  'pais',
  'sitioWeb',
  'textoPrivacidad',
  'mensajeCierre',
  'retencionMeses',
  'googleJobsHabilitado',
]);

function rechazar(mensaje: string): never {
  throw new ViolacionMultiempresaError(mensaje);
}

/**
 * Aplica las reglas de los modelos globales fuera del modo plataforma. Devuelve los args (posiblemente acotados).
 * `contexto` es undefined (sin contexto) o un contexto de empresa: el modo plataforma nunca llega aquí.
 */
export function protegerModeloGlobal(
  modelo: string,
  operacion: string,
  args: Record<string, unknown>,
  contexto: Extract<ContextoEmpresa, { modo: 'tenant' }> | undefined,
): Record<string, unknown> {
  const esLectura = LECTURAS.has(operacion);

  if (modelo === 'Usuario') {
    // Sin contexto no hay a quién acotar: el login usa ejecutarComoPlataforma('auth.login', …).
    if (!contexto) throw new SinContextoTenantError(modelo, operacion);
    if (!esLectura) rechazar(`Usuario.${operacion} solo está permitido en modo plataforma`);
    // Solo usuarios con membresía en la empresa activa. El hash lo cubren el omit global y rechazarCamposSecretos.
    return {
      ...args,
      where: agregarRestriccion(args.where, { membresias: { some: { organizacionId: contexto.organizacionId } } }),
    };
  }

  if (modelo === 'Organizacion') {
    if (!contexto) {
      if (!esLectura) rechazar(`Organizacion.${operacion} sin contexto: usa el modo plataforma`);
      return args;
    }
    const esActualizacion = ACTUALIZACIONES.has(operacion);
    if (!esLectura && !esActualizacion) {
      rechazar(`Organizacion.${operacion} no está permitido en contexto de empresa`);
    }
    if (esActualizacion) {
      const datos = (args.data ?? {}) as Record<string, unknown>;
      const prohibido = Object.keys(datos).find((campo) => !CAMPOS_EDITABLES_ORGANIZACION.has(campo));
      if (prohibido) rechazar(`Organizacion.${prohibido} solo lo cambia la plataforma`);
    }
    return { ...args, where: agregarRestriccion(args.where, { id: contexto.organizacionId }) };
  }

  // Cualquier otro modelo global (TokenRestablecer, SlugAnterior, EventoAuditoria, …) es solo de plataforma.
  if (!contexto) throw new SinContextoTenantError(modelo, operacion);
  rechazar(`${modelo} solo se usa en modo plataforma`);
}
