import type { TipoEventoAuditoria } from '@prisma/client';
import { ejecutarComoPlataforma } from './tenant/contexto';
import type { PrismaTenant } from './tenant/extension';

const CLAVES_PROHIBIDAS = new Set(
  ['email', 'telefono', 'documento', 'nombre', 'contrasena', 'password', 'token', 'tokenHash', 'passwordHash'].map((c) =>
    c.toLowerCase(),
  ),
);
const MAX_TEXTO = 200;

export interface EventoAuditable {
  tipo: TipoEventoAuditoria;
  usuarioId?: string;
  organizacionAfectadaId?: string;
  ip?: string;
  datos?: Record<string, string | number | boolean>;
}

interface LoggerErrores {
  error: (obj: unknown, msg?: string) => void;
}

function sanear(datos: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const salida: Record<string, string | number | boolean> = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (esClaveProhibida(clave)) {
      throw new Error(`auditar: la clave "${clave}" nombra datos personales y no puede registrarse`);
    }
    if (typeof valor !== 'string' && typeof valor !== 'number' && typeof valor !== 'boolean') {
      throw new Error(`auditar: el valor de "${clave}" debe ser string, number o boolean`);
    }
    salida[clave] = typeof valor === 'string' ? valor.slice(0, MAX_TEXTO) : valor;
  }
  return salida;
}

function esClaveProhibida(clave: string): boolean {
  return CLAVES_PROHIBIDAS.has(clave.toLowerCase());
}

/** Registra un evento de cuentas. Nunca rompe la operación de negocio: un fallo de base solo se loguea. */
export async function auditar(prisma: PrismaTenant, evento: EventoAuditable, logger?: LoggerErrores): Promise<void> {
  const datos = sanear(evento.datos ?? {});
  try {
    await ejecutarComoPlataforma('auditoria', () =>
      prisma.eventoAuditoria.create({
        data: {
          tipo: evento.tipo,
          usuarioId: evento.usuarioId ?? null,
          organizacionAfectadaId: evento.organizacionAfectadaId ?? null,
          ip: evento.ip ?? null,
          datos,
        },
      }),
    );
  } catch (err) {
    logger?.error({ err }, 'auditoria fallida');
  }
}
