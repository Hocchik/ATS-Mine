import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'criterio-api';
const AUDIENCE = 'criterio-web';
const DURACION_S = 12 * 3600;

export interface ContenidoSesion {
  usuarioId: string;
  versionSesion: number;
  empresa?: { organizacionId: string; membresiaId: string; versionMembresia: number };
}

const clave = (secreto: string) => new TextEncoder().encode(secreto);

export async function firmarSesion(
  contenido: ContenidoSesion,
  secreto: string,
  ahora: Date = new Date(),
): Promise<string> {
  const seg = Math.floor(ahora.getTime() / 1000);
  const claims: Record<string, string | number> = { sv: contenido.versionSesion };
  if (contenido.empresa) {
    claims.org = contenido.empresa.organizacionId;
    claims.mid = contenido.empresa.membresiaId;
    claims.mv = contenido.empresa.versionMembresia;
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(contenido.usuarioId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(seg)
    .setExpirationTime(seg + DURACION_S)
    .sign(clave(secreto));
}

export async function verificarSesion(
  token: string,
  secreto: string,
  ahora: Date = new Date(),
): Promise<ContenidoSesion | null> {
  try {
    const { payload } = await jwtVerify(token, clave(secreto), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: ahora,
    });
    const { sub, sv, org, mid, mv } = payload;
    if (typeof sub !== 'string' || typeof sv !== 'number') return null;
    if (org === undefined && mid === undefined && mv === undefined) {
      return { usuarioId: sub, versionSesion: sv };
    }
    if (typeof org !== 'string' || typeof mid !== 'string' || typeof mv !== 'number') return null;
    return {
      usuarioId: sub,
      versionSesion: sv,
      empresa: { organizacionId: org, membresiaId: mid, versionMembresia: mv },
    };
  } catch {
    return null;
  }
}
