import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'criterio-api';
const AUDIENCE = 'criterio-web';
const DURACION_S = 12 * 3600;
const LARGO_MINIMO_SECRETO = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ContenidoSesion {
  usuarioId: string;
  versionSesion: number;
  empresa?: { organizacionId: string; membresiaId: string; versionMembresia: number };
}

const clave = (secreto: string) => new TextEncoder().encode(secreto);
const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const esVersion = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const secretoValido = (secreto: string) => typeof secreto === 'string' && secreto.length >= LARGO_MINIMO_SECRETO;

function exigir(condicion: boolean, mensaje: string): asserts condicion {
  if (!condicion) throw new Error(`firmarSesion: ${mensaje}`);
}

export async function firmarSesion(
  contenido: ContenidoSesion,
  secreto: string,
  ahora: Date = new Date(),
): Promise<string> {
  exigir(secretoValido(secreto), `el secreto debe tener al menos ${LARGO_MINIMO_SECRETO} caracteres`);
  exigir(esUuid(contenido.usuarioId), 'usuarioId debe ser un UUID');
  exigir(esVersion(contenido.versionSesion), 'versionSesion debe ser un entero positivo');
  const seg = Math.floor(ahora.getTime() / 1000);
  const claims: Record<string, string | number> = { sv: contenido.versionSesion };
  if (contenido.empresa) {
    const { organizacionId, membresiaId, versionMembresia } = contenido.empresa;
    exigir(esUuid(organizacionId), 'organizacionId debe ser un UUID');
    exigir(esUuid(membresiaId), 'membresiaId debe ser un UUID');
    exigir(esVersion(versionMembresia), 'versionMembresia debe ser un entero positivo');
    claims.org = organizacionId.toLowerCase();
    claims.mid = membresiaId.toLowerCase();
    claims.mv = versionMembresia;
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(contenido.usuarioId.toLowerCase())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(seg)
    .setExpirationTime(seg + DURACION_S)
    .sign(clave(secreto));
}

/** Devuelve el contenido con los ids canonizados en minúsculas, o null ante cualquier token o claim inválido. */
export async function verificarSesion(
  token: string,
  secreto: string,
  ahora: Date = new Date(),
): Promise<ContenidoSesion | null> {
  if (!secretoValido(secreto)) return null;
  try {
    const { payload } = await jwtVerify(token, clave(secreto), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['sub', 'iat', 'exp', 'sv'],
      maxTokenAge: '12h',
      currentDate: ahora,
    });
    const { sub, sv, org, mid, mv } = payload;
    if (!esUuid(sub) || !esVersion(sv)) return null;
    if (org === undefined && mid === undefined && mv === undefined) {
      return { usuarioId: sub.toLowerCase(), versionSesion: sv };
    }
    if (!esUuid(org) || !esUuid(mid) || !esVersion(mv)) return null;
    return {
      usuarioId: sub.toLowerCase(),
      versionSesion: sv,
      empresa: { organizacionId: org.toLowerCase(), membresiaId: mid.toLowerCase(), versionMembresia: mv },
    };
  } catch {
    return null;
  }
}
