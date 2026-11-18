import { PrismaClient } from '@prisma/client';

/**
 * Cliente sin filtro multiempresa. Solo lo crean server.ts y las pruebas; los módulos reciben el cliente extendido.
 * Omit global: `Usuario.passwordHash` no se devuelve nunca, tampoco a través de relaciones (`include: { usuario }`,
 * `.usuario()`). Quien lo necesite (login, en modo plataforma) lo pide con `omit: { passwordHash: false }`.
 */
export function crearPrismaBase() {
  return new PrismaClient({ omit: { usuario: { passwordHash: true } } });
}

export type PrismaBase = ReturnType<typeof crearPrismaBase>;
