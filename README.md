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
4. `pnpm --filter @criterio/api db:migrate`
5. `git config core.hooksPath .githooks`

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
