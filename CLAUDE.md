# CLAUDE.md — Criterio

> **Fuente de verdad del diseño:** [docs/superpowers/specs/2026-11-17-criterio-ats-design.md](docs/superpowers/specs/2026-11-17-criterio-ats-design.md).
> Este archivo resume las reglas que **nunca** se rompen. Si algo no está aquí ni en el documento de diseño, pregunta antes de asumir.

## Qué es

**Criterio** es un ATS SaaS **multiempresa** con evaluación de CVs hecha por un **modelo de lenguaje abierto**: evidencia citada contra una rúbrica por vacante. Es una demo profesional sobre planes gratuitos, preparada para monetizar más adelante (modelo "C"). No mide consumo en la v1.

El código de GLONIS (`legacy/glonis/`) es **solo de referencia**: de ahí se reutilizan las reglas, no los archivos. Su documentación antigua está en [docs/legacy/GLONIS-CLAUDE.md](docs/legacy/GLONIS-CLAUDE.md).

## Repositorio y git

- Repositorio: `origin` = https://github.com/Hocchik/ATS-Mine (historial limpio, rama principal `main`). Cada fase se trabaja en su rama (`fase-N-…`).
- El remoto `glonis-original` es el repo original de GLONIS. **Nunca hacer push ahí ni modificarlo** (tiene el push deshabilitado localmente).
- El repo es público: **nunca documentar contraseñas, tokens ni secretos** en ningún archivo. `.claude/settings.json` no se publica porque tiene credenciales locales.

## Stack

| Pieza | Tecnología |
|---|---|
| Monorepo | `apps/web` · `apps/api` · `services/ai` · `packages/shared` |
| Web | React 19 · Vite · TypeScript · Tailwind 4 · shadcn/ui · TanStack Table/Query · dnd-kit · FullCalendar · Recharts |
| API | Node 22+ · Express · TypeScript · Prisma · PostgreSQL (Neon) · jose · bcryptjs · cookie-parser · express-rate-limit |
| IA | Python · FastAPI · Ollama/llama.cpp · pydantic · pytest |
| Compartido | Zod (esquemas, tipos, catálogo de errores) |
| Deploy | Vercel (web + función de metadatos) · Render (API) · Neon (DB) |

**No agregar dependencias** que no estén en el documento de diseño sin discutirlo primero.

## Reglas que nunca se rompen

1. **Un dato faltante nunca se convierte en 0 en un ranking.** Lo pendiente o fallido va en un grupo aparte.
2. **La IA mejora el proceso, nunca lo bloquea.** Todo flujo funciona con la IA apagada.
3. **El puntaje se calcula en un solo lugar:** `apps/api/src/modulos/evaluacion/puntaje.ts`. Ni Python ni el frontend calculan puntajes.
4. **El modelo propone, el código confirma.** Toda cita se verifica contra el texto del CV; si no aparece, nivel 0.
5. **La IA nunca cambia la etapa** de una postulación.
6. **El worker de IA nunca toca la base de datos.** Solo usa `/internal/*` con token de servicio y `leaseId`.
7. **La IA recibe solo texto anonimizado.** Nunca imágenes ni datos de contacto.
8. **Aislamiento entre empresas** (`apps/api/src/tenant/`):
   - Toda tabla de negocio lleva `organizacionId`, `@@unique([id, organizacionId])` y FKs compuestas hacia otras tablas de empresa. Una prueba de schema lo exige.
   - `MODELOS_TENANT` **se deriva del schema** (todo modelo con `organizacionId`). No hay lista manual que mantener.
   - El filtro lo pone la extensión de Prisma, **siempre con AND**: un id u `organizacionId` ajeno deja de coincidir; nunca se redirige a la empresa propia.
   - Fuera del modo plataforma: **ninguna escritura anidada por relación** (solo FKs escalares y operaciones de primer nivel) y **ninguna lectura que cruce de un modelo global a uno de empresa**.
   - `Usuario`: sin contexto es inaccesible (`SinContextoTenantError`); en contexto de empresa es solo lectura y solo ve miembros de esa empresa. Escrituras y login van por modo plataforma.
   - `passwordHash` nunca sale: omit global en el cliente, y fuera del modo plataforma cualquier mención en los args (select, where, orderBy, groupBy, etc.) se rechaza. Quien lo necesite (login) pide `omit: { passwordHash: false }` dentro de `ejecutarComoPlataforma`.
   - Los módulos reciben solo el cliente multiempresa (`PrismaTenant`); crear `PrismaClient` o usar `crearPrismaBase` fuera de `db/` y `server.ts` lo prohíbe ESLint.
   - `Organizacion`: en contexto de empresa, solo la propia y solo los campos de `CAMPOS_EDITABLES_ORGANIZACION`.
   - Auth, onboarding, superadmin y worker usan `ejecutarComoPlataforma(motivo, fn)` explícitamente.
   - Las consultas se hacen con `await` dentro de `ejecutarEnTenant` / `ejecutarComoPlataforma`.
   - `$queryRaw`/`$executeRaw` solo en `db/sql-revisado.ts` (los salta el filtro; lo exige ESLint).
   - El acceso a datos de otra empresa responde 404.
9. **Toda ruta se registra con `registro.definir()`** y se clasifica: `PUBLICA` | `AUTENTICADA` | `TENANT` (con `roles` opcionales) | `PLATAFORMA` (solo superadmin). Las no públicas viven bajo `/api/`.
   - `TENANT` exige sesión con empresa y un escenario de `aislamiento`, que la suite prueba con control positivo (la dueña, con `roles[0]`) y negativo (otra empresa recibe 404 o no ve el marcador). `AUTENTICADA` declara `{ noAplica: 'motivo' }`. A las `PLATAFORMA` la suite las prueba con OWNER/ADMIN/RECLUTADOR/sin empresa (todos deben recibir 403 FORBIDDEN).
   - El registro rechaza rutas duplicadas o sombreadas (normalización igual a Express 5). ESLint y una prueba que recorre las rutas de Express impiden registrar rutas por fuera.
   - En handlers `TENANT` usa `obtenerSesionEmpresa(res)`; en `AUTENTICADA` solo `obtenerSesion(res)` (la empresa activa es informativa: `obtenerEmpresaActivaOpcional`). Solo `src/http/sesion.ts` importa `ejecutarEnTenant` (ESLint).
10. **Fechas en UTC** en la base. Se muestran con `Intl`, en la zona horaria y el locale de la empresa, con la etiqueta de zona.
11. **Formato de error único:** `{ error: { code, message, details?, requestId } }`, con `code` del catálogo de `packages/shared`.
12. **Validación con Zod en todos los bordes:** body, query, params y resultados del worker.
13. **Los logs nunca contienen datos personales:** email, teléfono, documento, texto de CV, tokens ni cookies.
14. **La cookie de sesión debe quedar en el mismo sitio que la web:** `/api/*` pasa por el rewrite de Vercel con secreto de edge. `/public/*` va directo, sin cookies.
15. **CAPTCHA:** en desarrollo y pruebas, solo las claves de prueba oficiales de hCaptcha. Sin atajos por token.
16. **Los archivos binarios viven en `ArchivoBinario`** y solo los lee el adaptador de `Almacenamiento`. Nunca se cargan bytes en un `findMany`.
17. **Ningún modelo de Anthropic/Claude** para evaluar CVs (decisión de costo).
18. **Nunca se usan datos reales en el desarrollo**: solo CVs y empresas ficticias.
19. **Google Empleos (JSON-LD) apagado** hasta cumplir todas las condiciones de la §7.4 del diseño. Las empresas `esDemo` nunca lo emiten.
20. **Archivos de unas 250 líneas como máximo.** Backend organizado por dominio (`apps/api/src/modulos/…`) y frontend por funcionalidad (`features/…`).

21. **Autenticación** (`apps/api/src/auth/`, `src/http/{sesion,csrf,edge}.ts`):
   - Sesión = JWT HS256 en la cookie httpOnly `criterio_sesion` (SameSite=Lax, 12 h); el resolver revalida `Usuario.versionSesion` y `Membresia.version` con caché de 60 s y contador de generación.
   - Todo método que modifica: `Origin` ajeno → 403 en cualquier ruta; en rutas no públicas además se exige `Origin === WEB_ORIGIN` y CSRF de doble envío (`X-CSRF-Token` = cookie `criterio_csrf`).
   - **Invalidar la caché** (`sesiones.invalidarMembresia` / `invalidarUsuario`) **después del commit** cada vez que cambia un rol, se elimina un miembro, se suspende/reactiva una empresa o se restablece una contraseña.
   - Logout incrementa `versionSesion`: cierra la sesión en todos los dispositivos.
   - Solo el superadmin genera enlaces para restablecer contraseñas (un ADMIN de empresa podría tomar cuentas que son dueñas de otras empresas). Autoservicio por correo: Fase 10.
   - Modelos globales que no son `Usuario`/`Organizacion` (`TokenRestablecer`, `SlugAnterior`, `EventoAuditoria`) solo en modo plataforma; `tokenHash` y `passwordHash` son campos secretos (omitidos y rechazados fuera de plataforma).
   - Tokens de un solo uso: 32 bytes base64url, se guarda solo el sha256; nunca se registran en logs (el serializador oculta segmentos de ruta con forma de token).
   - Auditoría con `auditar()`: nunca datos personales en `datos` (se rechazan por patrón), siempre después del commit.
   - Operaciones que verifican y luego escriben (último OWNER, slugs, aceptar invitación) van en `enTransaccionSerializable` (reintenta P2034).

## Cómo trabajar

- **TDD en la lógica de negocio:** puntaje, anonimización, citas, aislamiento y máquina de estados.
- Lee antes de escribir y edita solo lo que cambia.
- Antes de dar algo por terminado: tipos, lint y pruebas en verde, con la evidencia en mano.
- **El aspecto visual no está decidido.** Hay una fase de diseño UX/UI propia antes de construir las pantallas. Mientras tanto, respeta solo las restricciones técnicas de la §9 del diseño.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Calidad de todo el monorepo |
| `pnpm --filter @criterio/api dev` | API en desarrollo (carga `apps/api/.env` si existe) |
| `pnpm --filter @criterio/api db:migrate` | Crear/aplicar migraciones en `criterio_dev` |
| `pnpm --filter @criterio/web dev` | Web en desarrollo |
| `cd services/ai && uv run pytest && uv run ruff check .` | Servicio de IA |

**Pruebas de la API:** necesitan `apps/api/.env.test` con una base cuyo nombre termine en `_test`. El global-setup aplica migraciones con `prisma migrate deploy` (no destructivo; Prisma bloquea `migrate reset` cuando lo ejecuta una IA) y cada prueba limpia sus tablas con `limpiarBase()`. Si una migración ya aplicada cambia, la persona reinicia `criterio_test` a mano.

**Al crear una ruta:** usa `registro.definir()`; si es `TENANT`, declara su `aislamiento`; si es un módulo nuevo, agrégalo en `apps/api/src/modulos/index.ts`.

**Secretos:** los archivos `.env*` reales nunca se leen ni se crean desde herramientas; las plantillas `*.example` llevan `CAMBIAR` y nada real. El hook `.githooks/pre-commit` corre gitleaks si está instalado.
