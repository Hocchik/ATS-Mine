import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export const COSTO_BCRYPT = 12;

let hashSenuelo: Promise<string> | null = null;
function obtenerHashSenuelo(): Promise<string> {
  hashSenuelo ??= hash(randomBytes(16).toString('hex'), COSTO_BCRYPT);
  return hashSenuelo;
}

export function hashearContrasena(texto: string, costo: number = COSTO_BCRYPT): Promise<string> {
  return hash(texto, costo);
}

/** Con hash nulo compara contra un señuelo para igualar el tiempo y devuelve false. */
export async function verificarContrasena(texto: string, hashGuardado: string | null): Promise<boolean> {
  if (hashGuardado === null) {
    await compare(texto, await obtenerHashSenuelo());
    return false;
  }
  return compare(texto, hashGuardado);
}
