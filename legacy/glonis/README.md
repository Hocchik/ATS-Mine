# Glonis ATS

Sistema de seguimiento de postulantes (ATS) para Glonis, tienda de ropa peruana. Reemplaza la revisión manual de perfiles por un flujo centralizado: formulario público de postulación → extracción y scoring automático de CV → panel de reclutamiento con Kanban, calendario y dashboard.

Proyecto universitario, sin infraestructura de pago en producción. La documentación completa de arquitectura, módulos y reglas de negocio vive en [CLAUDE.md](CLAUDE.md).

## Stack

- **Frontend:** React 18 + Vite 5 + Tailwind CSS 3
- **Backend:** Node.js 20 + Express + Prisma 5
- **Base de datos:** PostgreSQL (Neon en producción)
- **Auth:** JWT + bcrypt
- **CV:** extracción local con `pdf-parse` (sin IA externa), banco de palabras clave por puesto
- **CAPTCHA:** hCaptcha
- **Deploy:** Render (backend) + Vercel (frontend) + Neon (base de datos)

## Setup local

Requiere Node 20+, PostgreSQL 15 corriendo en `localhost:5432`.

```bash
# Backend
cd backend
cp .env.example .env        # completa DATABASE_URL, JWT_SECRET, HCAPTCHA_SECRET, SEED_ADMIN_PASSWORD
npm install
npm run db:migrate          # aplica migraciones de Prisma
npm run db:seed             # crea admin@glonis.pe con la contraseña de SEED_ADMIN_PASSWORD
npm run dev                 # http://localhost:3000

# Frontend (otra terminal)
cd frontend
cp .env.example .env         # completa VITE_HCAPTCHA_SITEKEY
npm install
npm run dev                  # http://localhost:5173
```

El proxy de Vite ya está configurado para `/api` y `/public` → `http://localhost:3000`.

## Estructura

```
backend/    API Express + Prisma (rutas, servicios, middlewares)
frontend/   Panel React (reclutadores) + formulario público de postulación
```

Ver sección 9 de [CLAUDE.md](CLAUDE.md) para el árbol de carpetas detallado.

## Deploy

- `render.yaml` en la raíz define el servicio web del backend (Render, free tier). El `DATABASE_URL` de Neon se configura manualmente en el dashboard de Render (Environment) — nunca en el repo.
- `frontend/vercel.json` define el rewrite de SPA para React Router.
- El build de Render corre `prisma migrate deploy` automáticamente (`npm run db:deploy`).

## Estado del proyecto

Ver sección 15 de [CLAUDE.md](CLAUDE.md) — registro de iteraciones y fixes aplicados en cada auditoría de código/seguridad.
