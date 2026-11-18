import pino, { type DestinationStream, type LevelWithSilent, type Logger } from 'pino';

const CAMPOS_SENSIBLES = [
  'email',
  'telefono',
  'documento',
  'password',
  'passwordHash',
  'contrasena',
  'token',
  'tokenHash',
  'secreto',
  'textoExtraido',
  'textoAnonimizado',
];

/** pino: `*` cubre exactamente un nivel, así que se ocultan en la raíz, a 1 y a 2 niveles de profundidad. */
export const CAMPOS_OCULTOS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-criterio-edge"]',
  'res.headers["set-cookie"]',
  ...CAMPOS_SENSIBLES.flatMap((campo) => [campo, `*.${campo}`, `*.*.${campo}`]),
];

interface PeticionSerializada {
  id?: unknown;
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * Serializador de `req` para pino-http: la url va sin query string (ahí suelen viajar emails o búsquedas) y no se
 * registran `query` ni `params`. Las cabeceras pasan por el `redact` del logger.
 */
export function serializarPeticion(req: PeticionSerializada): PeticionSerializada {
  return {
    id: req.id,
    method: req.method,
    url: req.url?.split('?')[0],
    headers: req.headers,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  };
}

export function crearLogger(nivel: LevelWithSilent, destino?: DestinationStream): Logger {
  const opciones = { level: nivel, redact: { paths: CAMPOS_OCULTOS, censor: '[oculto]' } };
  return destino ? pino(opciones, destino) : pino(opciones);
}
