# Criterio — Hoja de ruta de implementación

> Diseño: [2026-11-17-criterio-ats-design.md](../specs/2026-11-17-criterio-ats-design.md)
> Cada fase tiene **su propio plan detallado**, que se escribe al cerrar la fase anterior, porque depende del código que quede construido. Cada plan deja software que funciona y se puede probar por sí solo.

| Fase | Plan | Entregable que se puede probar | Depende de | Estado |
|---|---|---|---|---|
| 0 | [Base](2026-11-17-fase-0-base.md) | Monorepo con CI, errores, logs, Prisma base, filtro multiempresa y suite de aislamiento funcionando | — | ✅ Completa en local (CI escrita, se ejecuta al crear el repo nuevo) |
| 1 | Cuentas | Registro, login con cookie + CSRF, empresas, membresías, invitaciones, superadmin y verificación | 0 | Pendiente |
| 2 | Vacantes | CRUD de vacantes, criterios, preguntas, plantillas, bloqueo, publicar y duplicar (solo API) | 1 | Pendiente |
| 3 | Postulación pública | Eliminatorias, cuestionario, PDF o mini perfil, hCaptcha, anonimización, puntaje base, seguimiento y comprobante (API) | 2 | Pendiente |
| 4 | Servicio de IA | `TrabajoIA`, `/internal/*`, worker de Python, validación de citas, `ai:eval` y asistente | 3 | Pendiente |
| 5 | Diseño UX/UI | Referencias → recorridos → bocetos → alta fidelidad → validación. Sistema de componentes en `apps/web` | 0 (en paralelo con 1–4) | Pendiente |
| 6 | Panel | Lista por grupos, Expediente, a ciegas, Kanban, acciones en bloque, correcciones y evaluación manual (web + API) | 4, 5 | Pendiente |
| 7 | Entrevistas y fichas | Agenda, participantes, fichas ocultas hasta enviar y desacuerdos | 6 | Pendiente |
| 8 | Analítica | Embudo, tiempos, motivos y coincidencia IA–personas | 7 | Pendiente |
| 9 | Lado público para compartir | Función de metadatos, OG, sitemap, robots y JSON-LD (apagado) | 3, 5 | Pendiente |
| 10 | Operación y cierre de seguridad | Correo transaccional, retención, supresión ARCO, respaldos cifrados y revisión de seguridad | 1–9 | Pendiente |
| 11 | Mudanza y despliegue | Repositorio nuevo, Vercel, Render, Neon, Brevo y verificación en producción | 10 | Pendiente |

## Decisión pendiente: cuándo crear el repositorio nuevo

La CI (GitHub Actions) solo corre en un repositorio de GitHub, y el remoto actual (`glonis-original`) **no se toca**. Hay dos opciones:

- **Mudanza temprana (recomendada):** crear el repositorio nuevo al terminar la Fase 0, **con historial limpio** (sin los commits de GLONIS, que incluyen contraseñas publicadas). Así la CI protege desde la Fase 1.
- **Mudanza al final (Fase 11):** hasta entonces todo se verifica solo en local.

## Pendientes heredados de la Fase 0

- **Primera ejecución real de la CI** (incluida la verificación `prisma migrate diff`): al crear el repositorio nuevo.
- **Auditoría de dependencias** (§10 del diseño: `pnpm audit --prod`, `uv run pip-audit`, Dependabot): se agrega junto con la mudanza al repo nuevo.
- **Primer ítem del plan de la Fase 1:** separar `Sesion` en sesión de usuario y sesión de empresa, agregar los accesos `AUTENTICADA`/`PLATAFORMA`/`INTERNA` y `roles` por ruta, y definir la estrategia de `trust proxy` para `/api/*` detrás del rewrite de Vercel (§8.2).
