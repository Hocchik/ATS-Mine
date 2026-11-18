/**
 * Agrega una condición obligatoria a un `where` con AND, sin sobrescribir las claves del llamador.
 * Si el where pedía otra empresa u otro id, deja de coincidir en lugar de redirigirse a la empresa propia.
 */
export function agregarRestriccion(where: unknown, condicion: Record<string, unknown>): Record<string, unknown> {
  const actual = (where ?? {}) as Record<string, unknown>;
  const andPrevio = actual.AND === undefined ? [] : Array.isArray(actual.AND) ? actual.AND : [actual.AND];
  return { ...actual, AND: [...andPrevio, condicion] };
}
