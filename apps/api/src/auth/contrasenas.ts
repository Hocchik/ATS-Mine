import { compare, hash } from 'bcryptjs';

export const COSTO_BCRYPT = 12;

/**
 * Señuelo para igualar el tiempo cuando no hay hash guardado: bcrypt de costo COSTO_BCRYPT de un valor aleatorio
 * descartado (no es un secreto). Constante para que la primera llamada cueste lo mismo que las siguientes.
 */
export const HASH_SENUELO = '$2b$12$QZVk5ux1HH/WexPaUPisNe/fFlpyDBLN3YEkXGoisCIGg3Qck10BC';

export function hashearContrasena(texto: string, costo: number = COSTO_BCRYPT): Promise<string> {
  return hash(texto, costo);
}

/** Con hash nulo compara contra el señuelo para igualar el tiempo y devuelve false. */
export async function verificarContrasena(texto: string, hashGuardado: string | null): Promise<boolean> {
  if (hashGuardado === null) {
    await compare(texto, HASH_SENUELO);
    return false;
  }
  return compare(texto, hashGuardado);
}
