# Criterio

ATS multiempresa con evaluación de CVs por un modelo de lenguaje abierto: evidencia citada contra una rúbrica, verificada por código, con la decisión final en manos de una persona.

- Diseño: [docs/superpowers/specs/2026-11-17-criterio-ats-design.md](docs/superpowers/specs/2026-11-17-criterio-ats-design.md)
- Hoja de ruta: [docs/superpowers/plans/2026-11-17-criterio-hoja-de-ruta.md](docs/superpowers/plans/2026-11-17-criterio-hoja-de-ruta.md)

## Requisitos

Node 22 · pnpm 11 · PostgreSQL 17 · Python 3.12 + uv · (opcional) Ollama y gitleaks

## Puesta en marcha

1. `pnpm install`
2. Crear las bases `criterio_dev` y `criterio_test` en tu Postgres local.
3. Copiar `apps/api/.env.example` → `apps/api/.env` y `apps/api/.env.test.example` → `apps/api/.env.test`, reemplazando `CAMBIAR` por tu contraseña local.
4. Agregar a `apps/api/.env` las variables de la tabla de abajo.
5. `pnpm --filter @criterio/api db:migrate`
6. `git config core.hooksPath .githooks`

### Variables de entorno de la API

| Variable | Uso | Requerida |
|---|---|---|
| `DATABASE_URL` | Postgres (`criterio_dev`; las pruebas usan `criterio_test` desde `.env.test`) | Siempre |
| `JWT_SECRET` | Firma de la sesión, al menos 32 caracteres aleatorios | Siempre |
| `WEB_ORIGIN` | Origen exacto de la web, p. ej. `http://localhost:5173` (sin barra final) | Siempre |
| `EDGE_SECRET` | Secreto compartido con el proxy de Vercel para `/api/*` (≥ 32) | En producción |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` | Solo para `db:seed` | Al sembrar |

Un `JWT_SECRET` aleatorio: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

### Probar la autenticación con curl

Las rutas que modifican datos exigen `Origin` igual a `WEB_ORIGIN` y, con sesión, la cabecera `X-CSRF-Token` con el valor de la cookie `criterio_csrf`:

```bash
curl -i -c cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" \
  -d '{"nombre":"Ana","email":"ana@ejemplo.test","contrasena":"una-contrasena-larga"}' \
  http://localhost:3000/api/auth/registro
curl -b cookies.txt http://localhost:3000/api/auth/yo
```

Para un `POST` autenticado, agrega `-b cookies.txt -H "Origin: http://localhost:5173" -H "X-CSRF-Token: <valor de criterio_csrf en cookies.txt>"`.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | Calidad de todo el monorepo |
| `pnpm --filter @criterio/api dev` | API en modo desarrollo (puerto 3000) |
| `pnpm --filter @criterio/web dev` | Web en modo desarrollo |
| `cd services/ai && uv run pytest` | Pruebas del servicio de IA |
| `pnpm --filter @criterio/api db:seed` | Crea o actualiza el superadmin (ver abajo) |

## Superadmin

El seed (`apps/api/prisma/seed.ts`) crea el superadmin a partir de `SEED_SUPERADMIN_EMAIL` y `SEED_SUPERADMIN_PASSWORD` (mínimo 10 caracteres), definidas en `apps/api/.env` o en el entorno. Sin esas variables termina sin hacer nada. Si la persona ya existe, la vuelve superadmin, cambia su contraseña y cierra sus sesiones anteriores.

El superadmin verifica, suspende y reactiva empresas, y genera enlaces de un solo uso (1 h) para restablecer contraseñas (`/restablecer/<token>`).

El código de `legacy/glonis/` es el proyecto anterior (GLONIS) y se conserva solo como referencia.
