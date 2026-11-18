# Fase 1 — Cuentas · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personas que se registran, inician sesión con cookie httpOnly y CSRF, crean empresas (pendientes de verificación), gestionan su equipo e invitan miembros, y un superadmin que verifica o suspende empresas. Todo dentro de la guardia multiempresa de la Fase 0.

**Architecture:** La sesión vive en un JWT firmado (HS256, `jose`) dentro de la cookie `criterio_sesion` (httpOnly, SameSite=Lax, Secure en producción, 12 h). En cada petición, un resolver verifica el token y comprueba con caché de 60 s que `Usuario.versionSesion` y `Membresia.version` sigan vigentes y que la empresa no esté suspendida. El registro de rutas pasa a cuatro accesos: `PUBLICA`, `AUTENTICADA`, `TENANT` (con `roles` opcionales) y `PLATAFORMA` (solo superadmin). Toda ruta no pública exige CSRF de doble envío en métodos que modifican datos, y verificación de `Origin`. `/api/*` exige el secreto de edge cuando está configurado, y la IP del cliente se toma de la cabecera de Vercel solo si ese secreto es válido.

**Tech Stack:** se suman `jose` (JWT), `bcryptjs` (hash; puro JS, sin compilación nativa en Windows), `cookie-parser` y `express-rate-limit` (memoria; una sola instancia en Render).

**Diseño de referencia:** `docs/superpowers/specs/2026-11-17-criterio-ats-design.md` §2.3, §3.1, §5.2.1, §5.4, §8.2, §8.3. Reglas vigentes: `CLAUDE.md` → "Reglas que nunca se rompen".

---

## Decisiones de esta fase (nuevas respecto del diseño)

1. **Sesión en dos niveles.**
   - `SesionUsuario { usuarioId, esSuperadmin }`: usuario autenticado, todavía sin empresa (onboarding o "mis empresas").
   - `SesionEmpresa`: lo anterior más `{ organizacionId, membresiaId, rol }`.
   - El JWT lleva `sub`, `sv` (`versionSesion`) y, si hay empresa activa, `org`, `mid` y `mv` (`Membresia.version`).
2. **`Usuario.versionSesion`**: se incrementa al restablecer la contraseña. Invalida todos los tokens de esa persona ("cerrar sesión en todos lados").
3. **Restablecer contraseña en esta fase: solo el superadmin genera el enlace** (token de un solo uso, 1 h). Un ADMIN de empresa **no** puede, porque podría tomar la cuenta de alguien que también es dueño de otra empresa. El autoservicio por correo llega en la Fase 10.
4. **Invitaciones:** el enlace se copia, sin correo (el correo es de la Fase 10). Token de 32 bytes, se guarda su hash y vence a los 7 días. Se acepta estando autenticado y **solo si el email de la cuenta coincide** con el invitado.
5. **Otros modelos globales (`TokenRestablecer`, `SlugAnterior`, `EventoAuditoria`) solo se usan en modo plataforma.** La guardia rechaza cualquier acceso a modelos globales que no sean `Usuario` ni `Organizacion` fuera de ese modo. Así ningún modelo global nuevo queda abierto por omisión.
6. **`EventoAuditoria`** es global y su referencia a la empresa se llama `organizacionAfectadaId`, no `organizacionId`, para que no se derive como modelo multiempresa. Se escribe solo con `auditar()`, en modo plataforma, y nunca guarda emails ni contraseñas: solo ids, tipo, IP y datos no personales.
7. **Color de acento:** en esta fase solo se valida el formato hex (`#RRGGBB`). El control de contraste con OKLCH llega en la Fase 5, junto con la vista previa.
8. **Códigos de error nuevos:**

   | Código | HTTP |
   |---|---|
   | `CREDENCIALES_INVALIDAS` | 401 |
   | `CSRF_INVALIDO` | 403 |
   | `SIN_EMPRESA` | 403 |
   | `TOKEN_INVALIDO` | 400 |
9. **Las variables de entorno nuevas no se leen en las pruebas:** `crearApp` recibe un objeto `seguridad` con los secretos. Las pruebas usan valores fijos de prueba, y solo `server.ts` lee el entorno.

## Variables de entorno nuevas (las crea la persona, no las herramientas)

| Variable | Uso | Requerida |
|---|---|---|
| `JWT_SECRET` | Firma de la sesión (≥ 32 caracteres) | Siempre |
| `WEB_ORIGIN` | Origen permitido (verificación de `Origin`, enlaces de invitación) | Siempre |
| `EDGE_SECRET` | Secreto compartido con la función de Vercel para `/api/*` | En producción |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` | Solo para `pnpm --filter @criterio/api db:seed` | Al sembrar |

> Los archivos `.env*` reales y las plantillas `*.example` los edita la persona (un hook protege los secretos). Las tareas que necesiten variables nuevas las documentan en el README y avisan.

---

## Mapa de archivos

```
packages/shared/src/
  errores.ts                       + 4 códigos
  cuentas.ts / cuentas.test.ts     Zod: email, contraseña, nombre, slug (reservados), registro, login,
                                   crear/actualizar organización, invitación, cambio de rol
apps/api/
  prisma/schema.prisma             + Usuario.versionSesion, Invitacion, TokenRestablecer, SlugAnterior, EventoAuditoria
  prisma/seed.ts                   Superadmin desde variables de entorno
  src/config.ts                    + JWT_SECRET, WEB_ORIGIN, EDGE_SECRET (requerido en producción)
  src/auth/
    contrasenas.ts                 hashear / verificarContrasena (con hash señuelo)
    tokens-aleatorios.ts           generarToken / hashToken
    jwt.ts                         firmarSesion / verificarSesion (jose)
    cache-ttl.ts                   CacheTTL con reloj inyectable
    resolver-sesion.ts             crearResolverSesion: cookie → JWT → versiones vigentes
    cookies.ts                     emitir/limpiar cookies de sesión y CSRF
  src/http/
    sesion.ts                      SesionUsuario/SesionEmpresa, guardias (autenticado, tenant, rol, superadmin)
    registro.ts                    accesos v2 + roles + CSRF/Origin automáticos
    csrf.ts                        verificación de doble envío + Origin
    edge.ts                        exigirEdge + ipCliente
    limites.ts                     crearLimitador (express-rate-limit con el formato de error propio)
  src/auditoria.ts                 auditar()
  src/tenant/globales.ts           otros modelos globales: solo modo plataforma
  src/modulos/
    auth.ts                        registro, login, logout, yo, cambiar-empresa
    organizaciones.ts              crear empresa, ver/editar la propia, miembros
    invitaciones.ts                crear, listar, revocar, consultar (pública), aceptar
    superadmin.ts                  organizaciones (listar, verificar, suspender, reactivar), enlace de restablecer
    restablecer.ts                 POST /public/restablecer
  test/
    sesion-real.ts                 cookieDeSesion(): firma un JWT real para pruebas
    ...                            pruebas por tarea
```

---

### Task 1: Dependencias, configuración y códigos de error

**Files:** `apps/api/package.json`, `apps/api/src/config.ts`, `apps/api/test/unit/config.test.ts`, `packages/shared/src/errores.ts`, `packages/shared/src/errores.test.ts`, `apps/api/src/http/errores.ts`, `CLAUDE.md` (tabla de stack)

- [ ] **Step 1: Instalar**
```bash
pnpm --filter @criterio/api add jose@^6 bcryptjs@^3 cookie-parser@^1.4 express-rate-limit@^8
pnpm --filter @criterio/api add -D @types/cookie-parser@^1.4
```
Si alguna versión mayor no existe, usa la última estable y anótalo.

- [ ] **Step 2: Pruebas que fallan**
  - En `config.test.ts`:
    - Sin `JWT_SECRET` → lanza, nombrando la variable.
    - `JWT_SECRET` de menos de 32 caracteres → lanza.
    - `WEB_ORIGIN` que no es una URL `http(s)` → lanza.
    - En `NODE_ENV=production` sin `EDGE_SECRET` → lanza.
    - En `development` sin `EDGE_SECRET` → ok, con `EDGE_SECRET` `undefined`.
    - Las pruebas existentes se actualizan para pasar `JWT_SECRET` y `WEB_ORIGIN` válidos.
  - En `errores.test.ts` de shared: el catálogo incluye `CREDENCIALES_INVALIDAS`, `CSRF_INVALIDO`, `SIN_EMPRESA` y `TOKEN_INVALIDO`.
  - En `apps/api/test/unit/errores.test.ts`: los status son 401, 403, 403 y 400.

- [ ] **Step 3: Implementar**
  - `config.ts`: agregar
    - `JWT_SECRET: z.string().min(32)`
    - `WEB_ORIGIN: z.string().url()`, con refine que exija `http:` o `https:` y que no termine en `/`
    - `EDGE_SECRET: z.string().min(32).optional()`
  
    Agregar también un `superRefine`: si `NODE_ENV === 'production'` y no hay `EDGE_SECRET`, emitir un issue en la ruta `EDGE_SECRET`.
  - Códigos en `CODIGOS_ERROR` y en `STATUS_POR_CODIGO`.
  - `CLAUDE.md`: en la fila "API" de la tabla de stack, agregar `jose · bcryptjs · cookie-parser · express-rate-limit`.

- [ ] **Step 4:** `pnpm --filter @criterio/shared test && pnpm --filter @criterio/api test && pnpm typecheck && pnpm lint` en verde.
- [ ] **Step 5: Commit:** `feat(api): dependencias de autenticación, configuración de secretos y códigos de error de cuentas`

---

### Task 2: Schema de cuentas y guardia para los demás modelos globales

**Files:** `apps/api/prisma/schema.prisma`, nueva migración `cuentas`, `apps/api/src/tenant/globales.ts`, `apps/api/test/integracion/tenant-globales.test.ts`, `apps/api/test/fabricas.ts`

- [ ] **Step 1: Schema**
```prisma
model Usuario {
  // … campos existentes …
  versionSesion Int       @default(1)
  tokensRestablecer TokenRestablecer[]
}

model Organizacion {
  // … campos existentes …
  invitaciones  Invitacion[]
  slugsAnteriores SlugAnterior[]
}

/// Multiempresa (tiene organizacionId).
model Invitacion {
  id             String       @id @default(uuid()) @db.Uuid
  organizacionId String       @db.Uuid
  email          String
  rol            Rol
  tokenHash      String       @unique
  expiraEn       DateTime
  aceptadaEn     DateTime?
  revocadaEn     DateTime?
  creadaPorId    String       @db.Uuid
  creadoEn       DateTime     @default(now())
  organizacion   Organizacion @relation(fields: [organizacionId], references: [id], onDelete: Cascade)

  @@unique([id, organizacionId])
  @@index([organizacionId])
}

/// Global, solo modo plataforma.
model TokenRestablecer {
  id        String    @id @default(uuid()) @db.Uuid
  usuarioId String    @db.Uuid
  tokenHash String    @unique
  expiraEn  DateTime
  usadoEn   DateTime?
  creadoEn  DateTime  @default(now())
  usuario   Usuario   @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
}

/// Global, solo modo plataforma. Un slug anterior queda reservado para siempre (301 en la Fase 9).
model SlugAnterior {
  slug           String       @id
  organizacionIdDestino String @db.Uuid
  creadoEn       DateTime     @default(now())
  organizacion   Organizacion @relation(fields: [organizacionIdDestino], references: [id], onDelete: Cascade)
}

enum TipoEventoAuditoria {
  LOGIN
  LOGIN_FALLIDO
  REGISTRO
  CAMBIO_ROL
  MIEMBRO_ELIMINADO
  INVITACION_CREADA
  INVITACION_ACEPTADA
  INVITACION_REVOCADA
  ORGANIZACION_CREADA
  VERIFICACION_ORG
  SUSPENSION_ORG
  REACTIVACION_ORG
  RESTABLECER_GENERADO
  RESTABLECER_USADO
}

/// Global, solo modo plataforma. Nunca guarda emails ni contraseñas.
model EventoAuditoria {
  id                     String              @id @default(uuid()) @db.Uuid
  tipo                   TipoEventoAuditoria
  usuarioId              String?             @db.Uuid
  organizacionAfectadaId String?             @db.Uuid
  ip                     String?
  datos                  Json                @default("{}")
  creadoEn               DateTime            @default(now())

  @@index([organizacionAfectadaId, creadoEn])
}
```
> `SlugAnterior` usa `organizacionIdDestino`, y no `organizacionId`, para que no se derive como modelo multiempresa. Lo mismo vale para `EventoAuditoria.organizacionAfectadaId`.

Migración: `pnpm --filter @criterio/api exec prisma migrate dev --name cuentas`. Si Prisma bloquea la operación por haber detectado una IA, detente y avisa; no uses la variable de consentimiento.

- [ ] **Step 2: Pruebas que fallan (guardia)** en `tenant-globales.test.ts`:
  - `MODELOS_TENANT` incluye `Invitacion` y no incluye `TokenRestablecer`, `SlugAnterior` ni `EventoAuditoria`. La prueba de FKs compuestas y la de `@@unique([id, organizacionId])` siguen pasando.
  - **Fuera del modo plataforma, cualquier operación sobre `TokenRestablecer`, `SlugAnterior` o `EventoAuditoria` lanza:**
    - Con contexto de empresa → `ViolacionMultiempresaError`.
    - Sin contexto → `SinContextoTenantError`.
    
    Probar `findMany` y `create` en los dos casos.
  - En modo plataforma, las tres funcionan.
  - Una invitación de la empresa B no se ve desde A (`findMany`, `findUnique`), y `create` con el `organizacionId` de B lanza.
- [ ] **Step 3: Implementar.** En `protegerModeloGlobal`, rama por defecto: cualquier modelo global que no sea `Usuario` ni `Organizacion` → `SinContextoTenantError` si no hay contexto, o `ViolacionMultiempresaError` (`"<Modelo> solo se usa en modo plataforma"`) si hay contexto de empresa. Agregar a `fabricas.ts` la función `crearInvitacion(organizacionId, datos?)` con un `tokenHash` aleatorio.
- [ ] **Step 4:** pruebas, typecheck y lint en verde.
- [ ] **Step 5: Commit:** `feat(api): schema de cuentas (invitaciones, restablecer, slugs anteriores, auditoría) y modelos globales solo en modo plataforma`

---

### Task 3: Esquemas Zod de cuentas (shared)

**Files:** `packages/shared/src/cuentas.ts`, `packages/shared/src/cuentas.test.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1: Pruebas que fallan** (`cuentas.test.ts`):
  - **`emailSchema`:** recorta espacios y pasa a minúsculas (`'  Ana@Ejemplo.TEST '` → `'ana@ejemplo.test'`). Rechaza vacío, sin `@` y más de 150 caracteres.
  - **`contrasenaSchema`:**
    - Rechaza menos de 10 caracteres.
    - Rechaza más de 72 **bytes UTF-8** (con 25 `ñ`, que son 50 bytes, pasa; con 40 `ñ`, que son 80 bytes, falla). Es el límite de bcrypt.
  - **`nombrePersonaSchema`:** recorta espacios y exige entre 1 y 100 caracteres.
  - **`slugSchema`:**
    - Pasa a minúsculas, y exige `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`.
    - Rechaza `--` consecutivos.
    - Rechaza cada slug de `SLUGS_RESERVADOS`: `app`, `api`, `public`, `internal`, `login`, `registro`, `seguimiento`, `privacidad`, `admin`, `superadmin`, `empleos`, `static`, `assets`, `health`, `invitacion`, `restablecer`, `www`, `docs`.
  - **`registroSchema`:** `{ nombre, email, contrasena }`. **`loginSchema`:** `{ email, contrasena }`. En el login, la contraseña solo exige un mínimo de 1 carácter, para no revelar la política.
  - **`crearOrganizacionSchema`:**
    - `{ nombre (1–120), slug, zonaHoraria, locale, pais }`.
    - `zonaHoraria` debe estar en `Intl.supportedValuesOf('timeZone')` o ser `'UTC'`.
    - `locale`: `^[a-z]{2}-[A-Z]{2}$`.
    - `pais`: dos letras, que se pasan a mayúsculas.
  - **`actualizarOrganizacionSchema`:**
    - Todas las claves son opcionales y se usa `.strict()`. Las claves son exactamente las de `CAMPOS_EDITABLES_ORGANIZACION` de la API: `nombre`, `slug`, `logoClave`, `colorAcento`, `zonaHoraria`, `locale`, `pais`, `sitioWeb`, `textoPrivacidad`, `mensajeCierre`, `retencionMeses`, `googleJobsHabilitado`.
    - `colorAcento` debe ser `^#[0-9A-Fa-f]{6}$`.
    - `retencionMeses` es un entero entre 1 y 120.
    - `sitioWeb` debe ser una URL https.
    - `textoPrivacidad` tiene como máximo 20 000 caracteres y `mensajeCierre`, 1 000.
    - Una clave desconocida (`esDemo`) se rechaza.
  - **`crearInvitacionSchema`:** `{ email, rol }`, con `rol` en `ADMIN | RECLUTADOR | ENTREVISTADOR | OWNER`. **`cambiarRolSchema`:** `{ rol }`.
- [ ] **Step 2: Implementar** y exportar desde `index.ts`. Exportar también `ROLES` y el tipo `RolCuenta`.
- [ ] **Step 3: Agregar una prueba en la API** que verifique que las claves de `actualizarOrganizacionSchema.shape` coinciden con `CAMPOS_EDITABLES_ORGANIZACION`, para que las dos listas no se separen con el tiempo.
- [ ] **Step 4:** pruebas, typecheck y lint. **Commit:** `feat(shared): esquemas de cuentas (registro, login, organización, invitaciones) con slugs reservados`

---

### Task 4: Contraseñas, tokens aleatorios, JWT y caché

**Files:** `apps/api/src/auth/{contrasenas,tokens-aleatorios,jwt,cache-ttl}.ts` + `apps/api/test/unit/auth-*.test.ts`

- [ ] **Step 1: Pruebas que fallan**
  - **`contrasenas`:**
    - `hashearContrasena(texto, costo?)` devuelve un hash bcrypt (`$2`).
    - `verificarContrasena(texto, hash)` da `true` o `false`.
    - `verificarContrasena(texto, null)` da `false`, porque usa un **hash señuelo** para igualar el tiempo.
    - En las pruebas, costo 4. En producción, costo 12, constante `COSTO_BCRYPT`.
  - **`tokens-aleatorios`:**
    - `generarToken()` devuelve `{ token, hash }`: `token` son 32 bytes en base64url (43 caracteres) y `hash` es su sha256 en hex.
    - `hashToken(token) === hash`.
    - Dos tokens generados son distintos.
  - **`jwt`:**
    - `firmarSesion({ usuarioId, versionSesion, empresa?: { organizacionId, membresiaId, versionMembresia } }, secreto, ahora?)` y luego `verificarSesion(token, secreto, ahora?)` devuelven el mismo contenido.
    - Si el token se firmó con otro secreto, la verificación da `null`.
    - Un token vencido (12 h) da `null`.
    - Si se altera el payload, da `null`.
    - Si no tiene `iss` o `aud` correctos (`iss: 'criterio-api'`, `aud: 'criterio-web'`), da `null`.
    - Algoritmo `HS256` explícito en la verificación: un token con `alg: none` da `null`.
  - **`cache-ttl`:**
    - `new CacheTTL<K, V>(ttlMs, reloj = Date.now)`, con `obtener`, `guardar`, `borrar` y `limpiar`.
    - Una entrada vence al cumplirse el TTL; las pruebas usan un reloj inyectado.
- [ ] **Step 2: Implementar.** `verificarSesion` atrapa cualquier error de `jose` y devuelve `null`; nunca lanza.
- [ ] **Step 3:** pruebas, typecheck y lint. **Commit:** `feat(api): contraseñas, tokens aleatorios, JWT de sesión y caché TTL`

---

### Task 5: Sesión en dos niveles y resolver real

**Files:** `apps/api/src/http/sesion.ts`, `apps/api/src/auth/resolver-sesion.ts`, `apps/api/src/auth/cookies.ts`, `apps/api/test/sesion-real.ts`, `apps/api/test/integracion/resolver-sesion.test.ts`, `apps/api/test/sesion-prueba.ts` (adaptar a la nueva forma)

**Contrato:**
```ts
// http/sesion.ts
export interface SesionUsuario { usuarioId: string; esSuperadmin: boolean }
export interface SesionEmpresa extends SesionUsuario { organizacionId: string; membresiaId: string; rol: Rol }
export type Sesion = SesionUsuario | SesionEmpresa;
export const tieneEmpresa = (s: Sesion): s is SesionEmpresa => 'organizacionId' in s;
export type ResolverSesion = (req: Request) => Promise<Sesion | null>;
export function obtenerSesion(res: Response): Sesion;          // UNAUTHENTICATED si falta
export function obtenerSesionEmpresa(res: Response): SesionEmpresa; // SIN_EMPRESA si no tiene
```
```ts
// auth/cookies.ts
export const COOKIE_SESION = 'criterio_sesion';
export const COOKIE_CSRF = 'criterio_csrf';
export function emitirSesion(res, { token, segura }): { csrf: string }; // sesión httpOnly + csrf legible, SameSite=Lax, Path=/, 12 h
export function limpiarSesion(res, { segura }): void;
```
```ts
// auth/resolver-sesion.ts
export function crearResolverSesion(deps: { prisma: PrismaTenant; secreto: string; reloj?: () => number; ttlMs?: number }):
  { resolver: ResolverSesion; invalidarUsuario(usuarioId: string): void; invalidarMembresia(membresiaId: string): void };
```
**Comportamiento del resolver:**
1. Lee la cookie con `cookie-parser`, que ya está montado en `crearApp`.
2. `verificarSesion` → si falla, `null`.
3. **Usuario:** obtiene `{ versionSesion, esSuperadmin }` de la caché o, en modo plataforma (`'auth.resolver'`), de la base. Si la persona no existe o `versionSesion` no coincide con `sv`, el resultado es `null`.
4. **Empresa (si el token tiene `org`):** obtiene la membresía `{ version, rol, usuarioId, estadoOrganizacion }` de la caché o, en modo plataforma, de la base. La membresía debe existir, pertenecer a `sub`, tener `version === mv` y su empresa no puede estar `SUSPENDIDA`.
   - Si no se cumple, devuelve **la sesión de usuario sin empresa**: la persona sigue autenticada, pero pierde la empresa.
5. Caché de 60 s por usuario y por membresía. `invalidarUsuario` e `invalidarMembresia` las usan los módulos que cambian roles, eliminan miembros, suspenden empresas o restablecen contraseñas.

- [ ] **Step 1: Pruebas que fallan** (`resolver-sesion.test.ts`, con base real y la fábrica `cookieDeSesion` de `test/sesion-real.ts`, que firma con el `SECRETO_PRUEBA` fijo):
  - Cookie válida con empresa → `SesionEmpresa` con el rol correcto.
  - Cookie válida sin empresa → `SesionUsuario`.
  - Sin cookie, cookie basura o firmada con otro secreto → `null`.
  - Si `versionSesion` cambió en la base, después de `invalidarUsuario` → `null`.
  - Si la membresía se borró o su `version` subió, después de invalidar → `SesionUsuario` sin empresa.
  - Si la empresa quedó `SUSPENDIDA`, después de invalidar → sin empresa.
  - **Caché:** un cambio en la base sin invalidar se refleja al vencer el TTL (reloj inyectado) y no antes.
  - El token de la persona A con el `mid` de una membresía de B → sin empresa.
- [ ] **Step 2: Implementar** los tres archivos. En `crearApp`, montar `cookieParser()` antes del router. Adaptar `exigirTenant` y `resolverPrueba` a la nueva forma de `Sesion`; la integración completa con el registro llega en la Task 6.
- [ ] **Step 3:** todas las pruebas, typecheck y lint. **Commit:** `feat(api): sesión en dos niveles con resolver real (JWT en cookie, versiones vigentes y caché de 60 s)`

---

### Task 6: Registro de rutas v2 (accesos, roles, CSRF y Origin)

**Files:** `apps/api/src/http/registro.ts`, `apps/api/src/http/csrf.ts`, `apps/api/src/app.ts`, `apps/api/test/aislamiento/verificar.ts`, `apps/api/test/aislamiento/*.test.ts`, `apps/api/test/integracion/app.test.ts`, `apps/api/test/unit/registro.test.ts`

**Contrato:**
```ts
export type Acceso = 'PUBLICA' | 'AUTENTICADA' | 'TENANT' | 'PLATAFORMA';
export type Aislamiento = EscenarioAislamiento | { noAplica: string };
export interface DefinicionRuta {
  metodo: Metodo; ruta: string; acceso: Acceso;
  roles?: readonly Rol[];        // solo TENANT; sin roles = cualquier miembro
  aislamiento?: Aislamiento;      // TENANT: escenario obligatorio. AUTENTICADA: obligatorio (escenario o noAplica). PLATAFORMA: no se declara.
}
export function crearRegistro(deps: { resolverSesion: ResolverSesion; webOrigin: string }): RegistroRutas;
```
**Cadena por acceso** (todo con `switch` exhaustivo):

| Acceso | Cadena de guardias | Error si falla |
|---|---|---|
| `PUBLICA` | Solo los handlers | — |
| `AUTENTICADA` | `exigirAutenticado` → `verificarCsrf` → handlers | `UNAUTHENTICATED` |
| `TENANT` | `exigirAutenticado` → `exigirEmpresa` → `exigirRol(roles)` → `verificarCsrf` → `ejecutarEnTenant` → handlers | `SIN_EMPRESA` sin empresa, `FORBIDDEN` con otro rol |
| `PLATAFORMA` | `exigirAutenticado` → `exigirSuperadmin` → `verificarCsrf` → handlers | `FORBIDDEN` |

- `PLATAFORMA`: los handlers deciden qué partes corren con `ejecutarComoPlataforma`.
- Declarar `roles` en una ruta que no es `TENANT` lanza error al registrarla.

**`verificarCsrf(webOrigin)`:**
- En `GET`, `HEAD` y `OPTIONS` no se exige.
- En los demás métodos:
  - Si viene la cabecera `Origin` y no es igual a `webOrigin` → `CSRF_INVALIDO`.
  - La cabecera `X-CSRF-Token` debe ser igual a la cookie `criterio_csrf`, comparadas con `timingSafeEqual` y con largos verificados. Si no → `CSRF_INVALIDO`.

**Verificador de aislamiento:**
- `TENANT`: como hoy, pero `sesionPara` devuelve cabeceras con cookie real, CSRF y `Origin`.
- `AUTENTICADA` con `noAplica`: se cuenta como revisada y no se prueba. `AUTENTICADA` con escenario: se prueba como `TENANT`.
- `PLATAFORMA`: la petición la hace un OWNER de una empresa que **no** es superadmin, con los `:param` reemplazados por UUID aleatorios. Debe recibir **403**; cualquier otra respuesta es un fallo.

- [ ] **Step 1: Pruebas que fallan**
  - **`registro.test.ts`:**
    - `AUTENTICADA` sin `aislamiento` lanza.
    - `roles` en una ruta `PUBLICA` lanza.
    - Si se agrega un valor a `Acceso` sin manejarlo, falla la compilación. Esto ya está cubierto por el `never`; se verifica con un error de TS temporal.
  - **`app.test.ts`**, migrado al resolver real con `cookieDeSesion`:
    - `AUTENTICADA` sin cookie → 401.
    - `TENANT` con sesión sin empresa → 403 `SIN_EMPRESA`.
    - `TENANT` con `roles: ['OWNER']` y un RECLUTADOR → 403 `FORBIDDEN`.
    - `PLATAFORMA` con un no superadmin → 403; con superadmin → 200.
    - `POST` en `AUTENTICADA` sin `X-CSRF-Token` → 403 `CSRF_INVALIDO`; con un token distinto de la cookie → 403; con un `Origin` ajeno → 403; con todo correcto → 200.
    - `GET` sin CSRF → 200.
  - **Autoprueba del verificador:**
    - Una ruta `PLATAFORMA` que olvida `exigirSuperadmin`, simulada con una ruta de prueba registrada como `AUTENTICADA` pero declarada en el verificador como `PLATAFORMA`, se detecta. La forma recomendada es que el verificador reciba las definiciones y una ruta mal protegida responda 200.
    - Una ruta `AUTENTICADA` con `noAplica` se cuenta y no falla.
- [ ] **Step 2: Implementar.** Mover a `test/sesion-real.ts` el helper `cabecerasDeSesionReal({ usuarioId, organizacionId? })`: crea la membresía si hace falta, firma la cookie y agrega `X-CSRF-Token` y `Origin`.
- [ ] **Step 3:** todas las pruebas (la suite real de aislamiento sigue en verde), typecheck y lint. **Commit:** `feat(api): registro de rutas con accesos AUTENTICADA/TENANT/PLATAFORMA, roles, CSRF y Origin`

---

### Task 7: Secreto de edge, IP del cliente y limitador

**Files:** `apps/api/src/http/edge.ts`, `apps/api/src/http/limites.ts`, `apps/api/src/app.ts`, `apps/api/test/integracion/edge.test.ts`, `apps/api/test/unit/limites.test.ts`

**Comportamiento:**
- **`exigirEdge(edgeSecret?)`** se monta en `app.use('/api', …)`:
  - Si hay secreto: la cabecera `x-criterio-edge` debe coincidir (comparación con `timingSafeEqual`). Si no coincide → 403 `FORBIDDEN`. Si coincide → `res.locals.edgeVerificado = true`.
  - Si no hay secreto (desarrollo o pruebas): deja pasar con `edgeVerificado = false`.
- **`ipCliente(req, res)`:**
  - Con `edgeVerificado`: primer valor de `x-vercel-forwarded-for` o, si no está, de `x-real-ip`.
  - Sin edge: `req.ip`, con `trust proxy 1` para el salto de Render en `/public/*`.
- **`crearLimitador({ ventanaMs, maximo, clave })`:**
  - Usa `express-rate-limit` con `keyGenerator` igual a `clave(req, res)`, que por defecto es `ipCliente`.
  - Su `handler` llama a `next(new AppError('RATE_LIMITED', 'Demasiados intentos, espera un momento'))`.
  - Activa `standardHeaders: 'draft-7'` y desactiva `legacyHeaders`.

- [ ] **Step 1: Pruebas que fallan**
  - Con secreto: `/api/x` sin cabecera → 403; con la cabecera correcta → pasa; con una incorrecta del mismo largo → 403.
  - `/public/x` no exige la cabecera.
  - `ipCliente` con edge verificado devuelve la IP de `x-vercel-forwarded-for`. Sin edge, **ignora** esas cabeceras (una IP falsa en `x-vercel-forwarded-for` no se usa).
  - Limitador con máximo 2 → la tercera petición da 429 con el formato de error propio (`respuestaErrorSchema` válido, código `RATE_LIMITED`).
  - Las claves del limitador separan por IP: dos IP distintas, con edge simulado, no comparten el contador.
- [ ] **Step 2: Implementar.** `crearApp` recibe `seguridad: { jwtSecret, webOrigin, edgeSecret?, cookiesSeguras }`. Monta `exigirEdge` antes del router y pasa `webOrigin` al registro.
- [ ] **Step 3:** pruebas, typecheck y lint. **Commit:** `feat(api): secreto de edge para /api, IP real del cliente y limitador con el formato de error propio`

---

### Task 8: Auditoría

**Files:** `apps/api/src/auditoria.ts`, `apps/api/test/integracion/auditoria.test.ts`

```ts
export async function auditar(prisma: PrismaTenant, evento: {
  tipo: TipoEventoAuditoria; usuarioId?: string; organizacionAfectadaId?: string; ip?: string; datos?: Record<string, string | number | boolean>;
}): Promise<void>
```
- Escribe en modo plataforma (`'auditoria'`).
- **Rechaza las claves de `datos` que nombren datos personales**: `email`, `telefono`, `documento`, `nombre`, `contrasena`, `password`, `token`, `tokenHash`, `passwordHash`. Lanza error de programación.
- Si la escritura falla, **registra el error en el log y no rompe** la operación de negocio. La auditoría nunca bloquea un login.

- [ ] Pruebas:
  - Escribe la fila con sus campos.
  - `datos: { email: 'x' }` lanza.
  - Si la base falla (un `prisma` falso cuyo `create` rechaza), `auditar` no lanza.
- [ ] **Commit:** `feat(api): auditoría de eventos de cuentas sin datos personales`

---

### Task 9: Módulo de autenticación

**Files:** `apps/api/src/modulos/auth.ts`, `apps/api/src/modulos/index.ts`, `apps/api/test/integracion/auth.test.ts`

**Rutas:**

| Método y ruta | Acceso | Comportamiento |
|---|---|---|
| `POST /api/auth/registro` | PUBLICA | Body `registroSchema`. Crea el usuario en modo plataforma con `hashearContrasena`. Email duplicado → 409 `DUPLICATE` con el mensaje genérico "No se pudo crear la cuenta con esos datos". Emite la sesión sin empresa, audita `REGISTRO` y responde 201 con `{ usuario: { id, nombre, email } }`. Limitador: 10 por hora por IP. |
| `POST /api/auth/login` | PUBLICA | Body `loginSchema`. Busca a la persona en modo plataforma, con `omit: { passwordHash: false }`. Siempre llama a `verificarContrasena` (con señuelo si no existe). Si falla → 401 `CREDENCIALES_INVALIDAS`, mismo mensaje y mismo camino, y audita `LOGIN_FALLIDO` con `usuarioId` solo si existe y la IP. Si acierta, elige la empresa activa: la membresía más reciente cuya empresa no esté `SUSPENDIDA`, o ninguna. Emite la sesión, audita `LOGIN` y responde `{ usuario, empresaActiva? }`. Limitadores: 20 cada 15 min por IP y 10 cada 15 min por email normalizado (clave = hash del email, no el email). |
| `POST /api/auth/logout` | AUTENTICADA (`noAplica`) | Limpia las cookies y responde 204. |
| `GET /api/auth/yo` | AUTENTICADA (`noAplica`) | `{ usuario: { id, nombre, email, esSuperadmin }, empresas: [{ organizacionId, nombre, slug, rol, estadoVerificacion }], empresaActiva }`, leído en modo plataforma solo para la persona de la sesión. |
| `POST /api/auth/cambiar-empresa` | AUTENTICADA (`noAplica`) | Body `{ organizacionId }`. Verifica que exista la membresía y que la empresa no esté suspendida; si no → 404 `NOT_FOUND`. Vuelve a emitir la sesión con esa empresa. |

**Notas:**
- Los handlers que usan el modo plataforma lo hacen con un `motivo` explícito: `'auth.registro'`, `'auth.login'`, etc.
- **La cookie de sesión nunca viaja en el cuerpo de la respuesta.**

- [ ] **Step 1: Pruebas que fallan** (`auth.test.ts`, con `supertest.agent` para conservar las cookies):
  - Registro → 201 con las cookies `criterio_sesion` (httpOnly, SameSite=Lax) y `criterio_csrf`. Después, `GET /api/auth/yo` → 200 sin empresas.
  - Registro con un email existente → 409 y mensaje genérico.
  - Login correcto → 200. Con contraseña incorrecta y con email inexistente → 401 con **el mismo cuerpo**, salvo el `requestId`.
  - Login de alguien con 2 membresías, una en una empresa suspendida → la empresa activa es la que no está suspendida.
  - `POST /api/auth/logout` sin CSRF → 403. Con CSRF → 204, y después `/yo` → 401.
  - `cambiar-empresa` a una empresa sin membresía → 404. A una propia → 200, y `/yo` muestra la nueva empresa activa.
  - El limitador del login por email bloquea al intento número 11 aunque cambie la IP (con edge simulado).
  - **La respuesta del login nunca contiene `passwordHash`** (`expect(res.text).not.toContain('$2')`).
  - **Auditoría:** el login fallido deja `LOGIN_FALLIDO` sin el email en `datos`.
  - La suite de aislamiento sigue en verde.
- [ ] **Step 2: Implementar** y agregar el módulo en `modulosDeLaApp`, que pasa a recibir `{ prisma, sesiones, seguridad }`. `sesiones` es lo que devuelve `crearResolverSesion`.
- [ ] **Step 3:** pruebas, typecheck y lint. **Commit:** `feat(api): registro, login, logout, yo y cambio de empresa con cookies y CSRF`

---

### Task 10: Módulo de organizaciones y miembros

**Files:** `apps/api/src/modulos/organizaciones.ts`, `apps/api/test/integracion/organizaciones.test.ts`

**Rutas:**

| Método y ruta | Acceso | Comportamiento |
|---|---|---|
| `POST /api/organizaciones` | AUTENTICADA (`noAplica`) | Body `crearOrganizacionSchema`. En modo plataforma (`'organizaciones.crear'`) y en una sola transacción: verifica que el slug no esté usado ni en `Organizacion.slug` ni en `SlugAnterior` (si lo está → 409 `DUPLICATE`), crea la empresa (`PENDIENTE`) y la membresía `OWNER`. Audita `ORGANIZACION_CREADA`, vuelve a emitir la sesión con la empresa nueva y responde 201. |
| `GET /api/organizacion` | TENANT | La empresa propia. |
| `PUT /api/organizacion` | TENANT, `roles: ['OWNER','ADMIN']` | Body `actualizarOrganizacionSchema`. Si cambia el slug, verifica que no exista en ninguno de los dos lugares y guarda el anterior en `SlugAnterior` (modo plataforma, en la misma transacción). |
| `GET /api/organizacion/miembros` | TENANT | `[{ membresiaId, usuario: { id, nombre, email }, rol, creadoEn }]` |
| `PATCH /api/organizacion/miembros/:membresiaId` | TENANT, `roles: ['OWNER','ADMIN']` | Body `cambiarRolSchema`. Ver reglas abajo. |
| `DELETE /api/organizacion/miembros/:membresiaId` | TENANT, `roles: ['OWNER','ADMIN']` | Mismas reglas. Responde 204 y audita `MIEMBRO_ELIMINADO`. |

**Reglas de `PATCH` y `DELETE` de miembros** (se verifican dentro de una `$transaction`):
- Un ADMIN no puede modificar ni eliminar a un OWNER, ni asignar el rol OWNER → 403 `FORBIDDEN`.
- No se puede dejar a la empresa sin OWNER → 409 `HAS_DEPENDENCIES` con un mensaje claro.
- Cada cambio incrementa `Membresia.version` e invalida la membresía en la caché de sesiones. El cambio de rol audita `CAMBIO_ROL`.

**Escenarios de aislamiento:**
- `GET`/`PUT /api/organizacion`: tipo `COLECCION`, con marcador = id de la empresa dueña.
- Miembros: `RECURSO`, con `:membresiaId` de la empresa dueña.
- El `PUT` del intruso no debe modificar la empresa dueña, cosa que el filtro garantiza. El cuerpo del `PUT` debe ser válido; por ejemplo, `{ nombre: 'X' }`.

- [ ] **Step 1: Pruebas que fallan:**
  - Crear una empresa → 201 en estado `PENDIENTE`. `/yo` la muestra como activa con rol OWNER.
  - Un slug reservado → 400. Un slug en uso o que figura como anterior → 409.
  - Un RECLUTADOR que hace `PUT /api/organizacion` → 403.
  - Un ADMIN que intenta degradar a un OWNER → 403.
  - El último OWNER que intenta degradarse a sí mismo → 409. Con dos OWNER, sí puede.
  - Después de un cambio de rol, la sesión vieja de esa persona refleja el rol nuevo apenas se invalida la caché, sin esperar 60 s.
  - Eliminar a un miembro → su sesión pierde la empresa.
  - Cambiar el slug → el anterior queda en `SlugAnterior` y otra empresa ya no puede tomarlo.
  - **`PUT` con `esDemo: true` → 400**, porque el esquema es `.strict()`. Además, la guardia lo bloquearía.
  - La suite real de aislamiento revisa estas rutas y no reporta fallos.
- [ ] **Step 2: Implementar.** **Step 3:** verde. **Commit:** `feat(api): crear empresa, editar la propia y gestionar miembros con reglas de OWNER/ADMIN`

---

### Task 11: Invitaciones

**Files:** `apps/api/src/modulos/invitaciones.ts`, `apps/api/test/integracion/invitaciones.test.ts`

**Rutas:**

| Método y ruta | Acceso | Comportamiento |
|---|---|---|
| `POST /api/organizacion/invitaciones` | TENANT, `roles: ['OWNER','ADMIN']` | Body `crearInvitacionSchema`. Solo un OWNER puede invitar a otro OWNER. Si el email ya es miembro → 409. Usa `generarToken()`, guarda el hash y una expiración de 7 días, y audita `INVITACION_CREADA`. Responde 201 con `{ id, email, rol, expiraEn, enlace: \`${webOrigin}/invitacion/${token}\` }`. **El token sale solo en esta respuesta.** |
| `GET /api/organizacion/invitaciones` | TENANT, `roles: ['OWNER','ADMIN']` | Lista las pendientes, sin token ni hash. |
| `DELETE /api/organizacion/invitaciones/:id` | TENANT, `roles: ['OWNER','ADMIN']` | Marca `revocadaEn` y audita `INVITACION_REVOCADA`. |
| `GET /public/invitaciones/:token` | PUBLICA | En modo plataforma (`'invitaciones.consultar'`), busca por `hashToken(token)`. Si es válida (no aceptada, no revocada, no vencida) → `{ organizacion: { nombre }, email, rol }`. Si no → 400 `TOKEN_INVALIDO`, mismo mensaje en todos los casos. Limitador: 30 cada 15 min por IP. |
| `POST /api/invitaciones/:token/aceptar` | AUTENTICADA (`noAplica`) | En modo plataforma y en una transacción: valida la invitación como el `GET` y exige que el email de la persona coincida con el invitado; si no → 400 `TOKEN_INVALIDO`. Si ya es miembro → 409. Crea la membresía, marca `aceptadaEn`, audita `INVITACION_ACEPTADA`, vuelve a emitir la sesión con esa empresa y responde 200. |

- [ ] **Step 1: Pruebas que fallan:**
  - El ciclo completo: el OWNER invita, la persona invitada se registra con ese email y acepta → 200, y `/yo` muestra la empresa.
  - Aceptar con una cuenta de otro email → 400.
  - Aceptar dos veces → la segunda, 400.
  - Una invitación vencida (cambiando `expiraEn` en la base) → 400.
  - Una invitación revocada → 400.
  - Un ADMIN que invita a un OWNER → 403.
  - Invitar a alguien que ya es miembro → 409.
  - `GET /public/invitaciones/<token>` con un token inventado → 400. La respuesta nunca incluye `tokenHash`.
  - **Aislamiento:** la empresa B no lista ni revoca invitaciones de A. El escenario de `DELETE` es un `RECURSO` con el id de una invitación de la empresa dueña.
- [ ] **Step 2: Implementar.** **Step 3:** verde. **Commit:** `feat(api): invitaciones con enlace de un solo uso, verificación de email y vencimiento`

---

### Task 12: Superadmin, restablecer contraseña y seed

**Files:** `apps/api/src/modulos/superadmin.ts`, `apps/api/src/modulos/restablecer.ts`, `apps/api/prisma/seed.ts`, `apps/api/package.json` (scripts `db:seed` y `prisma.seed`), `apps/api/test/integracion/superadmin.test.ts`

**Rutas:**

| Método y ruta | Acceso | Comportamiento |
|---|---|---|
| `GET /api/superadmin/organizaciones?estado=` | PLATAFORMA | Lista con `{ id, nombre, slug, estadoVerificacion, creadoEn, miembros }`. `estado` se valida contra el enum. |
| `POST /api/superadmin/organizaciones/:id/verificar` | PLATAFORMA | Body `{ dominioCorreoVerificado?: boolean }`. Pasa a `VERIFICADA` y guarda `verificadaPorId` y `verificadaEn`. Audita `VERIFICACION_ORG`. |
| `POST /api/superadmin/organizaciones/:id/suspender` | PLATAFORMA | Pasa a `SUSPENDIDA`, audita `SUSPENSION_ORG` e invalida en la caché todas las membresías de esa empresa. |
| `POST /api/superadmin/organizaciones/:id/reactivar` | PLATAFORMA | Vuelve a `VERIFICADA` si alguna vez lo estuvo (`verificadaEn` no nulo) o, si no, a `PENDIENTE`. Audita `REACTIVACION_ORG`. |
| `POST /api/superadmin/usuarios/:id/enlace-restablecer` | PLATAFORMA | Crea un `TokenRestablecer` con vencimiento de 1 h, audita `RESTABLECER_GENERADO` y responde `{ enlace: \`${webOrigin}/restablecer/${token}\`, expiraEn }`. |
| `POST /public/restablecer` | PUBLICA | Body `{ token, contrasena }` (`contrasenaSchema`). En modo plataforma y en una transacción: valida el token (no usado, no vencido); si falla → 400 `TOKEN_INVALIDO`. Actualiza el hash, **incrementa `versionSesion`**, marca `usadoEn`, invalida al usuario en la caché y audita `RESTABLECER_USADO`. Responde 204. Limitador: 10 cada 15 min por IP. |

**Seed:** `prisma/seed.ts` crea o actualiza en modo plataforma al superadmin con `SEED_SUPERADMIN_EMAIL` y `SEED_SUPERADMIN_PASSWORD`, validados con los esquemas de shared. Sin esas variables, termina con un mensaje claro y sin hacer nada.

- [ ] **Step 1: Pruebas que fallan:**
  - Una persona no superadmin en las rutas de superadmin → 403. El verificador también lo comprueba de forma automática.
  - Verificar una empresa → `VERIFICADA` con `verificadaPorId`.
  - Suspender una empresa → la sesión de un miembro de esa empresa pierde la empresa de inmediato.
  - Reactivar → vuelve al estado correcto según el historial.
  - **Ciclo de restablecer:** el superadmin genera el enlace y `POST /public/restablecer` cambia la contraseña. La sesión anterior de esa persona → 401, porque `versionSesion` subió. El login con la contraseña nueva funciona y con la vieja no.
  - Usar dos veces el mismo token → 400. Un token vencido → 400.
  - **Ningún endpoint de superadmin devuelve `passwordHash`.**
- [ ] **Step 2: Implementar** y probar el seed en la base de desarrollo **solo si la persona ya configuró las variables**. Si no, se documenta en el README y no se ejecuta.
- [ ] **Step 3:** verde. **Commit:** `feat(api): superadmin (verificar, suspender, reactivar), restablecer contraseña con enlace de un solo uso y seed`

---

### Task 13: Cableado de server.ts, documentación y cierre

**Files:** `apps/api/src/server.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/plans/2026-11-17-criterio-hoja-de-ruta.md`

- [ ] `server.ts`:
  - Construye `seguridad` con la configuración (`cookiesSeguras = NODE_ENV === 'production'`).
  - Crea `crearResolverSesion({ prisma, secreto: JWT_SECRET })`.
  - Pasa `sesiones` y `seguridad` a `crearApp` y a `modulosDeLaApp`.
- [ ] **Prueba de humo:** `build` + `start`.
  - Si la persona ya agregó `JWT_SECRET` y `WEB_ORIGIN` a `apps/api/.env`: `GET /health` → 200, y `POST /api/auth/registro` con `curl` → 201 con cookies.
  - Si no las agregó: se informa y se omite.
- [ ] **README:** variables nuevas, cómo sembrar el superadmin y cómo probar el flujo con `curl` (cookie y cabecera CSRF).
- [ ] **CLAUDE.md:** reglas de autenticación.
  - La sesión, el CSRF y `Origin`.
  - La regla de que solo el superadmin restablece contraseñas.
  - Los modelos globales nuevos solo en modo plataforma.
  - Usar `obtenerSesionEmpresa` en las rutas `TENANT`.
  - Invalidar la caché cuando cambian membresías o la empresa.
- [ ] **Hoja de ruta:** Fase 1 → ✅.
- [ ] **Verificación final:** `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test`, y `uv run pytest` en `services/ai`.
- [ ] **Commit:** `docs: Fase 1 completa (cuentas)`

---

## Cobertura del diseño

| Requisito | Task |
|---|---|
| §2.3 JWT con la empresa activa, membresía verificada en cada petición (60 s), `Membresia.version` | 4, 5 |
| §8.2 Cookie en el mismo sitio, secreto de edge, IP real solo con secreto | 5, 7 |
| §8.3 bcrypt 12, mínimo 10, límites por IP y email, mismo mensaje y tiempo | 3, 4, 9 |
| §8.3 CSRF de doble envío y `Origin` | 6 |
| §5.2.1 Registro → empresa pendiente → invitar | 9, 10, 11 |
| §5.4 Permisos por rol, último OWNER, superadmin | 6, 10, 12 |
| §3.1 `Invitacion`, `TokenRestablecer`, `SlugAnterior`, `EventoAuditoria` | 2 |
| §3.6.11 Slugs reservados y anteriores | 3, 10 |

**Queda para fases siguientes:**
- Correo transaccional y restablecer por autoservicio (Fase 10).
- Contraste OKLCH del color (Fase 5).
- Redirección 301 de slugs anteriores (Fase 9).
- El acceso `INTERNA` para el worker (Fase 4).
- CORS de `/public/*` (Fase 3).
