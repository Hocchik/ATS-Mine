import { ViolacionMultiempresaError } from './relaciones';

/** Campos que solo se leen, filtran u ordenan en modo plataforma. Hoy solo Usuario.passwordHash. */
export const CAMPOS_SECRETOS: readonly string[] = ['passwordHash'];

/** Claves cuyo valor nombra campos como texto (`by: ['passwordHash']`, `distinct: 'passwordHash'`). */
const CLAVES_QUE_NOMBRAN_CAMPOS = new Set(['by', 'distinct']);

const SECRETOS = new Set(CAMPOS_SECRETOS);

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) return false;
  const prototipo = Object.getPrototypeOf(valor) as unknown;
  return prototipo === Object.prototype || prototipo === null;
}

function rechazar(campo: string, ruta: string): never {
  throw new ViolacionMultiempresaError(`${ruta}: ${campo} solo se usa en modo plataforma`);
}

function nombraSecreto(valor: unknown): string | undefined {
  const nombres = Array.isArray(valor) ? valor : [valor];
  return nombres.find((n): n is string => typeof n === 'string' && SECRETOS.has(n));
}

/** Referencia de columna de Prisma (`prisma.usuario.fields.passwordHash`): objeto con `name` y `modelName`. */
function esReferenciaASecreto(valor: unknown): string | undefined {
  if (typeof valor !== 'object' || valor === null) return undefined;
  const { name, modelName } = valor as { name?: unknown; modelName?: unknown };
  return typeof name === 'string' && typeof modelName === 'string' && SECRETOS.has(name) ? name : undefined;
}

function recorrer(valor: unknown, ruta: string, vistos: WeakSet<object>): void {
  const referencia = esReferenciaASecreto(valor);
  if (referencia) rechazar(referencia, ruta);
  if (Array.isArray(valor)) {
    if (vistos.has(valor)) return;
    vistos.add(valor);
    valor.forEach((v, i) => recorrer(v, `${ruta}[${i}]`, vistos));
    return;
  }
  // Solo objetos planos: Date, Decimal, Buffer o Uint8Array no llevan claves de consulta.
  if (!esObjetoPlano(valor) || vistos.has(valor)) return;
  vistos.add(valor);
  for (const [clave, hijo] of Object.entries(valor)) {
    const rutaHijo = ruta ? `${ruta}.${clave}` : clave;
    if (SECRETOS.has(clave)) rechazar(clave, rutaHijo);
    if (CLAVES_QUE_NOMBRAN_CAMPOS.has(clave)) {
      const nombrado = nombraSecreto(hijo);
      if (nombrado) rechazar(nombrado, rutaHijo);
    }
    recorrer(hijo, rutaHijo, vistos);
  }
}

/**
 * Fuera del modo plataforma, rechaza cualquier mención a un campo secreto en los args de una consulta, a cualquier
 * profundidad: where, select, include, omit (incluso en `true`), orderBy, by, distinct, _min, _max, _count, having,
 * data… Así no se lee, no se filtra ("adivinar" con startsWith) ni se ordena por él. Lo que la consulta DEVUELVE
 * lo cubre el omit global del cliente (src/db/prisma.ts).
 */
export function rechazarCamposSecretos(args: unknown): void {
  recorrer(args, '', new WeakSet());
}
