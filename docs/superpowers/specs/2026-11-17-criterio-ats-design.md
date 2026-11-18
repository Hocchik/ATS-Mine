# Criterio — Documento de diseño (v1)

> **Estado:** aprobado por secciones en la sesión de diseño del 2026-11-17. Pendiente de la revisión final del documento completo.
> **Origen:** reescritura del ATS de GLONIS (`glonis-original`, solo de referencia, no se modifica) como SaaS multiempresa genérico.
> **Nombre:** "Criterio" (provisional).

---

## 0. Resumen

Criterio es un ATS (sistema de seguimiento de postulantes) **multiempresa** en el que cualquier empresa publica vacantes, recibe postulaciones y obtiene una **evaluación de cada CV hecha por un modelo de lenguaje abierto**. La evaluación es **evidencia citada contra una rúbrica por vacante**: la máquina propone, el código verifica y la persona decide.

**Objetivo del proyecto (modelo "C"):** demo funcional de calidad profesional con planes gratuitos, preparada para monetizar más adelante. **Sin medición de consumo en la v1.**

**Principios no negociables:**

1. **La IA mejora el proceso, nunca lo bloquea.** El ATS funciona completo sin IA (puntaje base inmediato). La evaluación de IA llega cuando llega.
2. **Un dato faltante nunca se convierte en 0 en un ranking.** Lo pendiente se agrupa aparte; nunca se mezcla ni se ordena como si valiera cero.
3. **El modelo propone, el código confirma.** Los puntajes los calcula TypeScript en un único lugar. Las citas se verifican contra el texto del CV.
4. **Aislamiento entre empresas por construcción**: lo garantizan la base de datos y la CI, no la memoria del programador.
5. **Decisión humana**: la IA nunca cambia la etapa de una postulación.
6. **Privacidad por defecto**: la IA recibe solo texto anonimizado. Nunca se usan datos reales en el desarrollo.
7. **Ante la duda, fallar de forma visible**, por ejemplo una ruta sin clasificar rompe la CI, en lugar de equivocarse sin avisar.

---

## 1. Alcance

### 1.1 Correcciones obligatorias respecto de GLONIS

| Fallo en GLONIS | Corrección en Criterio |
|---|---|
| El CV vive en `Candidato`, así que una nueva postulación pisa el CV anterior | El CV pertenece a la `Postulacion` (`DocumentoCV`) |
| `upsert` por email permite sobrescribir la identidad de otra persona (`public.js:169`) | Copia de los datos de contacto en cada postulación; `Candidato` nunca se sobrescribe automáticamente |
| Palabras clave con `includes()`: falsos positivos y sin sinónimos | Evaluación por rúbrica con IA y citas verificadas |
| "Coherencia" empieza en 0 y castiga a quien no fue calificado | Se elimina; regla del dato faltante; grupos separados |
| Sin historial, notas ni motivo de descarte | `EventoPostulacion` + motivo obligatorio al descartar |
| Puestos, palabras clave y cuestionario de retail escritos en el código | Vacantes, criterios, preguntas y plantillas configurables por empresa |
| Hora de Perú y Ley 29733 escritas en el código | Zona horaria, locale y textos legales por empresa |
| JWT en `localStorage` | Cookie httpOnly en el mismo sitio + CSRF |

### 1.2 Funciones nuevas de la v1

Los números son los de la lista original de novedades.

- **(1)** Evaluación con IA y evidencia citada.
- **(2)** Revisión a ciegas.
- **(3)** Preguntas eliminatorias.
- **(4)** Portal de seguimiento del candidato.
- **(6)** Fichas de evaluación de entrevista.
- **(7)** Asistente de vacantes con IA.
- **(9)** Analítica del proceso.

Más: correo transaccional mínimo (§8.4), vistas previas OG al compartir y JobPosting para Google Empleos (construido y **apagado**, §7.4).

### 1.3 Fuera de la v1

- Correos de notificación por etapa (5), banco de talento (8), comparador lado a lado (10) y autoagendamiento (11).
- Medición de consumo y cobros.
- Etapas configurables por empresa.
- Modo oscuro y otros idiomas de interfaz (las variables de diseño ya lo permiten).
- OCR de PDFs escaneados.
- Row-Level Security de Postgres (preparado como segunda capa futura).
- Indexing API de Google.

### 1.4 Aspecto visual: fase propia

El lenguaje visual **no se fija en este documento**. La propuesta "Híbrido limpio" se descartó por simplista. Antes de construir el frontend hay una **fase de diseño UX/UI** con estos pasos:

1. Referencias (Ashby, Teamtailor, Greenhouse y productos con buena interfaz para mucha información).
2. Recorridos de usuario y arquitectura de la información.
3. Bocetos de las pantallas clave.
4. Alta fidelidad: componentes, movimiento y visualización de datos.
5. Validación con una lista de chequeo de UX y accesibilidad.

Este documento solo fija las **restricciones técnicas** de la interfaz (§9).

---

## 2. Arquitectura

### 2.1 Vista general

```
                    ┌──────────────────── Vercel ─────────────────────┐
 Candidato ────────▶│ Web (React 19 + Vite + TS)                      │
 Reclutador ───────▶│  /app/*            panel (SPA)                  │
                    │  /{org}/empleos/*  función de metadatos (HTML)  │
                    │  /api/*  ── rewrite (mismo sitio) ──┐            │
                    └──────────────────────────────────────┼───────────┘
            /public/* directo (CORS)                       │ + secreto de edge
                    ┌──────────────────────────────────────▼─── Render ──┐
                    │ API (Express + TS + Prisma)                        │
                    │ módulos: auth · organizaciones · vacantes ·        │
                    │ postulaciones · evaluacion · entrevistas ·         │
                    │ analitica · publico · interno · superadmin         │
                    └──────────────┬─────────────────────────▲───────────┘
                                   │ Prisma                  │ /internal/* (token + leaseId)
                    ┌──────────────▼──────────┐   ┌──────────┴──────────────────┐
                    │ PostgreSQL (Neon)       │   │ Servicio IA (Python ·       │
                    │ datos + archivos + cola │   │ FastAPI · Ollama/llama.cpp) │
                    └─────────────────────────┘   │ Tu PC → HF Space / VPS      │
                                                  └─────────────────────────────┘
```

### 2.2 Monorepo

```
criterio/
├── apps/
│   ├── web/          React 19 + Vite + TS + Tailwind 4 (+ función de metadatos)
│   └── api/          Express + TS + Prisma
├── services/
│   └── ai/           Python · FastAPI · cliente de Ollama/llama.cpp · pytest
├── packages/
│   └── shared/       Esquemas Zod, tipos, catálogo de códigos de error, constantes
├── docs/
└── .github/workflows/
```

- `packages/shared` es la **única fuente** de la forma de los datos. Los esquemas Zod se exportan como JSON Schema para el contrato con el worker de Python (§10).
- Backend organizado **por dominio** (`apps/api/src/modulos/vacantes/…`). Frontend organizado **por funcionalidad** (`features/vacantes/…`). Ningún archivo pasa de unas 250 líneas.

### 2.3 Multiempresa

- `Usuario` ↔ `Organizacion` mediante `Membresia` con un rol por empresa: **OWNER · ADMIN · RECLUTADOR · ENTREVISTADOR**. Hay además un rol de plataforma, **superadmin** (`Usuario.esSuperadmin`).
- El JWT lleva la **empresa activa**. Una **extensión de Prisma** agrega `organizacionId` a todas las consultas de modelos de negocio.
- **Todas** las tablas de negocio llevan `organizacionId`, con **claves foráneas compuestas** `(id, organizacionId)` para que Postgres impida relaciones entre empresas.
- `$queryRaw` y `$executeRaw` solo se permiten en un archivo revisado (`db/sql-revisado.ts`). Una regla de lint lo hace cumplir.
- El acceso a un recurso de otra empresa responde **404** (no 403).
- **Guardia de relaciones (definida en la Fase 0):** fuera del modo plataforma no hay escrituras anidadas por relación ni lecturas que crucen de un modelo global a uno de empresa; las restricciones se agregan con AND (nunca se sobrescribe el `where`); `Usuario` es de solo lectura y en contexto de empresa solo ve miembros de esa empresa, sin `passwordHash`; `Organizacion` solo expone la propia y una lista blanca de campos editables. `MODELOS_TENANT` se deriva del schema.
- La membresía se verifica en cada petición (caché de 60 s). `Membresia.version` invalida los tokens anteriores cuando cambia el rol o se elimina al miembro.

### 2.4 Infraestructura y planes gratuitos

| Pieza | Servicio | Medidas por las limitaciones del plan gratuito |
|---|---|---|
| Web + función de metadatos | Vercel Hobby | Plan **no comercial**: para cobrar hay que pasar a Pro o mudarse a Cloudflare Pages. La función no usa APIs propias de Vercel. |
| API | Render free | Se duerme a los 15 min: despertar previo al abrir el formulario (`GET /health`, que no toca la base) y estados de carga explícitos. |
| Base de datos | Neon free (0,5 GB) | Se duerme sola: nada la consulta si no hay trabajo (§2.5). Archivos en una tabla aparte, con interfaz `Almacenamiento` lista para R2. |
| IA | Ollama en tu PC (desarrollo) | Se puede mover a un HF Space o a un VPS cambiando `API_URL` y `WORKER_TOKEN`. |
| Correo | Brevo free (300/día, remitente verificado) | Interfaz `Correo`; si no está configurado, la aplicación igual funciona (§8.4). |

### 2.5 Cola de trabajos de IA

- Tabla propia **`TrabajoIA`**, tomada con `SELECT … FOR UPDATE SKIP LOCKED`. **Sin pg-boss y sin Redis.**
- **El worker nunca toca la base.** Solo usa estos endpoints:
  - `POST /internal/trabajos/tomar` → `{ trabajo, leaseId }` o 204.
  - `POST /internal/trabajos/:id/resultado` (requiere `leaseId`).
  - `POST /internal/latido` cada 30 s.
- Autenticación del worker: **token de servicio** guardado con hash en `TokenServicio`, rotable.
- La API mantiene en memoria un indicador **`hayPendientes`**. Las consultas del worker con el indicador apagado no tocan la base. El indicador se enciende al encolar un trabajo o cuando vence un lease (la API recuerda en memoria los leases que entregó) y se recalcula **solo al arrancar**. Ningún temporizador consulta la base periódicamente, para que Neon pueda dormir.
- Mientras el worker está encendido, sus consultas (como mucho cada 5 min) mantienen despierto a Render. Eso entra en las 750 h mensuales del plan gratuito para un solo servicio. Con el worker apagado, Render vuelve a dormir.
- **Espera progresiva** del worker cuando no hay trabajo: 5 s → 30 s → 5 min.
- **Lease** de 5 min. Si vence, el trabajo vuelve a la cola. Hay 3 intentos y luego queda `FALLIDO`, con un botón "Reintentar". Un resultado con un `leaseId` o un intento viejo se descarta.
- **Reparto justo:** se toma el trabajo más antiguo de la empresa que lleva más tiempo sin ser atendida.
- Los trabajos llevan **solo texto anonimizado** y la rúbrica.
- Latido: la API guarda el último latido, el modelo y la versión **solo en memoria**. Escribirlo en la base cada 30 s impediría que Neon se duerma. La interfaz muestra "IA conectada / desconectada" (desconectada = más de 90 s sin latido). Tras un reinicio de la API, el estado es "desconocido" hasta el siguiente latido (≤ 30 s).

### 2.6 Riesgos de arquitectura aprobados (registro)

1. Espera progresiva + indicador en memoria para que Neon pueda dormir.
2. Despertar previo de Render + estados de carga claros.
3. Puntaje base inmediato + IA con máquina de estados y reintentos.
4. Interfaz `Almacenamiento` + retención por empresa.
5. Defensa contra inyección de instrucciones: CV etiquetado como `<documento>`, verificación de citas y heurísticas.
6. Evidencia inventada: se detecta con la misma verificación de citas.
7. Pruebas de aislamiento entre empresas, restricción de `$queryRaw`, RLS en el futuro.
8. Cookie httpOnly + CSRF.
9. PDFs escaneados (< 200 caracteres) → bandera `SIN_TEXTO`, confianza baja y revisión manual.

---

## 3. Modelo de datos

Todas las fechas en **UTC**. Se muestran en la zona horaria de cada empresa. **(org)** = lleva `organizacionId` y una clave foránea compuesta.

### 3.1 Plataforma, cuentas y empresas

```
Usuario          id · email (único global) · nombre · passwordHash · esSuperadmin · creadoEn
Organizacion     id · nombre · slug (único, no reservado) · logoClave? · colorAcento (validado AA)
                 zonaHoraria (IANA) · locale (es-PE…) · pais (ISO) · sitioWeb?
                 textoPrivacidad · mensajeCierre · retencionMeses
                 estadoVerificacion: PENDIENTE | VERIFICADA | SUSPENDIDA
                 verificadaPor? · verificadaEn? · dominioCorreoVerificado (bool)
                 esDemo · googleJobsHabilitado · creadoEn
SlugAnterior     slug (único) · organizacionId · creadoEn        → 301 a la URL nueva; slug reservado para siempre
Membresia        usuarioId · organizacionId · rol: OWNER | ADMIN | RECLUTADOR | ENTREVISTADOR
                 version (int) · creadoEn · único (usuario, organizacion)               (org)
Invitacion       email · rol · tokenHash · expiraEn · aceptadaEn?                        (org)
TokenRestablecer usuarioId · tokenHash · expiraEn · usadoEn?
TokenServicio    nombre · tokenHash · creadoEn · revocadoEn?
```

### 3.2 Vacantes configurables

```
Vacante          titulo · slug (único por org) · descripcion (HTML saneado) · requisitosVisibles
                 modalidad: PRESENCIAL | REMOTO | HIBRIDO · tipoContrato
                 ciudad? · region? · pais (ISO) · salarioMin? · salarioMax? · moneda? · periodoSalario?
                 estado: BORRADOR | ACTIVA | PAUSADA | CERRADA · fechaCierre? · validoHasta?
                 cvModo: REQUERIDO | OPCIONAL · pesoIA (def. 70) · pesoCuestionario (def. 30)
                 publicarEnGoogle · intentosNoCumplen (contador anónimo)
                 bloqueada (true desde la 1.ª postulación) · creadoPor · creadoEn · publicadaEn?   (org)
CriterioVacante  vacanteId · nombre · descripcion · peso · tipo: OBLIGATORIO | DESEABLE
                 descriptoresNivel: { 0..4: texto } · orden                                   (org)
PreguntaVacante  vacanteId · texto · tipo: LIKERT | SI_NO | OPCION | TEXTO · opciones?
                 eliminatoria · respuestaEsperada? · invertida · puntua (bool) · orden          (org)
PlantillaVacante nombre · contenido (Json: datos de vacante + criterios + preguntas)             (org)
MotivoDescarte   texto · activo · orden   (cada empresa recibe una lista inicial)                (org)
```

- Los criterios y preguntas se **copian** dentro de la vacante: cambiar la plantilla no afecta lo ya creado.
- Con la primera postulación, `bloqueada = true`: los criterios, preguntas y pesos de la rúbrica ya no se editan. Para cambiarlos se **duplica la vacante**. Los pesos IA/cuestionario sí se pueden editar, y al cambiarlos se **recalcula `puntajeFinal` de toda la vacante en una transacción** con la función única.

### 3.3 Candidatos y postulaciones

```
Candidato        nombre · email · telefono? · documento? · creadoEn · único (org, email)      (org)
                 → nunca se sobrescribe automáticamente
Postulacion      candidatoId · vacanteId · alias (aleatorio, p. ej. "Candidato K7Q")
                 contacto snapshot: nombre · email · telefono · documento · ubicacion
                 etapa: POSTULADO | EN_REVISION | ENTREVISTA | OFERTA | CONTRATADO | DESCARTADO | RETIRADO
                 estadoIA: PENDIENTE | PROCESANDO | LISTA | FALLIDA
                 puntajeBase · puntajeIA? · puntajeFinal? · evaluacionVigenteId?
                 banderas[] (las del cuestionario, p. ej. RESPUESTAS_UNIFORMES)
                 motivoDescarteId? · comentarioDescarte?
                 consentimientoEn · declaracionJuradaEn
                 tokenSeguimientoHash · tokenExpiraEn
                 retiradaEn? · supresionSolicitadaEn? · supresionEjecutarEn?
                 claveIdempotencia (única) · version (bloqueo optimista) · creadoEn · actualizadoEn   (org)
                 ÚNICO (vacanteId, candidatoId) WHERE etapa <> 'RETIRADO'   ← índice parcial (SQL en la migración)
DocumentoCV      postulacionId · origen: PDF | MINI_PERFIL · archivoClave? · miniPerfil (Json)?
                 textoExtraido · textoAnonimizado · legible · truncado · paginas?              (org)
ArchivoBinario   id · bytes · mime · tamano   ← solo lo lee el adaptador de Almacenamiento     (org)
Respuesta        postulacionId · preguntaId · valor                                             (org)
```

### 3.4 Evaluación

```
TrabajoIA          tipo: EVALUAR_CV | ASISTENTE_VACANTE · postulacionId? · payload (Json, anonimizado)
                   estado: PENDIENTE | TOMADO | COMPLETADO | FALLIDO · intento · leaseId? · leaseExpiraEn?
                   error? · creadoEn · completadoEn?                                            (org)
EvaluacionIA       postulacionId · origen: IA | MANUAL · version · modelo · versionPrompt · licenciaModelo
                   veredicto · fortalezas[] · brechas[] · confianza: ALTA | MEDIA | BAJA
                   banderas[]: INYECCION | SIN_TEXTO | CITAS_FALLIDAS | ANONIMIZACION_DUDOSA
                               | DECLARACION_NO_RESPALDADA | TRUNCADO
                   puntaje · duracionMs · marcadaCorrectaPor? · marcadaCorrectaEn? · creadoEn   (org)
EvaluacionCriterio evaluacionId · criterioId · nivel (0–4) · evidencia? · evidenciaVerificada     (org)
EvaluacionDeclaracion evaluacionId · preguntaId · respaldada (bool)                             (org)
CorreccionIA       evaluacionCriterioId · nivelIA → nivelHumano · usuarioId · motivo · creadoEn  (org)
```

### 3.5 Proceso, entrevistas y auditoría

```
EventoPostulacion  postulacionId · tipo: CAMBIO_ETAPA | NOTA | REVELAR_IDENTIDAD | EVALUACION
                   | CORRECCION | RETIRO | SUPRESION · deEtapa? · aEtapa? · usuarioId? · datos (Json)
                   creadoEn                                                                     (org)
Entrevista         postulacionId · fechaHora (UTC) · duracionMin · modalidad: PRESENCIAL | VIDEOLLAMADA
                   lugarOEnlace? · estado: PROGRAMADA | REALIZADA | CANCELADA · notas?              (org)
ParticipanteEntrevista entrevistaId · usuarioId                                                 (org)
FichaEvaluacion    entrevistaId · evaluadorId · recomendacion: FUERTE_SI | SI | NO | FUERTE_NO
                   comentario? · enviadaEn? · único (entrevista, evaluador)                      (org)
FichaPuntaje       fichaId · criterioId · nivel (0–4) · nota?                                   (org)
EventoAuditoria    usuarioId? · tipo: LOGIN | LOGIN_FALLIDO | CAMBIO_ROL | REVELAR_IDENTIDAD
                   | EXPORTACION | ELIMINACION | VERIFICACION_ORG | ROTACION_TOKEN · datos (Json)
                   ip? · creadoEn                                            (org cuando aplica)
Reporte            vacanteId · motivo · texto? · creadoEn · revisadoEn?      (reportes de vacante)
```

### 3.6 Decisiones del modelo (registro)

1. Los datos de contacto se copian en cada postulación; `Candidato` nunca se sobrescribe automáticamente. Si hay diferencias con postulaciones anteriores, la interfaz avisa: "Datos distintos a su postulación del 12/03".
2. `organizacionId` en todas las tablas de negocio + claves foráneas compuestas.
3. `ArchivoBinario` en una tabla aparte, para que ningún `findMany` cargue bytes.
4. Criterios y preguntas bloqueados con la primera postulación + `evaluacionVigenteId` + recálculo en una transacción.
5. Verificación de membresía en cada petición + `Membresia.version`.
6. Bloqueo optimista con `Postulacion.version`. La IA solo escribe en sus propios campos y nunca cambia la etapa.
7. Anonimización usando los valores conocidos del formulario (§6.3).
8. La supresión (ARCO) **anonimiza** en lugar de borrar: vacía los datos personales y borra el CV, pero conserva las cifras. La misma función la usa la retención automática.
9. La exportación para entrenar usa solo `textoAnonimizado`.
10. Volver a postular a la misma vacante muestra un mensaje amable con el enlace de seguimiento. Sí se permite si la postulación anterior está `RETIRADO`.
11. Lista de slugs reservados (`app`, `api`, `public`, `internal`, `login`, `seguimiento`, `privacidad`, `admin`, `empleos`, `static`, `assets`, `health`…), validada con Zod. A eso se suman los de `SlugAnterior`.
12. Token de seguimiento: 32 bytes aleatorios, guardado con hash, que vence `retencionMeses` después del cierre del proceso.
13. No se guarda ninguna postulación si el candidato no cumple una eliminatoria: solo se incrementa `intentosNoCumplen`.
14. Etapa `CONTRATADO` para medir el tiempo hasta la contratación. `RETIRADO` como estado final que permite volver a postular. Se elimina la "coherencia" manual.

---

## 4. Puntaje

**Única función de cálculo:** `apps/api/src/modulos/evaluacion/puntaje.ts`. Nadie más calcula puntajes, ni Python ni el frontend.

- **`puntajeBase`** (0–100), inmediato. Sale de las preguntas con `puntua = true`: LIKERT normalizada (las `invertida` usan `6 − valor`), SI_NO y OPCION según el valor esperado. Sin preguntas puntuables, `puntajeBase` es nulo y el peso del cuestionario se ignora.
- **`puntajeIA`** (0–100) = `Σ(peso × nivel/4) / Σpeso × 100` sobre los criterios de la evaluación vigente. Una cita no verificada vale **nivel 0**.
- **`puntajeFinal`** = combinación ponderada (`pesoIA`, `pesoCuestionario`, normalizados) **solo si existen ambos componentes**. Si falta `puntajeIA`, `puntajeFinal` es **nulo**.
- **Ranking de la vacante:**
  - **"Evaluadas"**: `puntajeFinal` no nulo, ordenadas de mayor a menor.
  - **"Esperando evaluación (N)"**: `estadoIA` PENDIENTE o PROCESANDO. Grupo aparte, por fecha.
  - **"Requieren revisión manual (N)"**: `estadoIA` FALLIDA o confianza BAJA. Grupo aparte. Desde ahí el reclutador puede **evaluar a mano**: llena los niveles por criterio y se crea una `EvaluacionIA` con `origen = MANUAL`, que entra al ranking.
- **Versiones de modelo mezcladas** en una vacante → aviso "Evaluaciones de 2 versiones de modelo" + botón **Reevaluar vacante**.
- **`RESPUESTAS_UNIFORMES`**: todas las respuestas iguales aunque haya invertidas → bandera visible. No cambia el puntaje.

---

## 5. Flujos

### 5.1 Candidato (público, sin cuenta)

```
/{org}/empleos → /{org}/empleos/{vacante} → Postular (4 pasos) → Confirmación → /seguimiento/{token}
```

1. **Página de la vacante:** requisitos obligatorios visibles desde el inicio, tiempo estimado para postular ("unos 8 minutos") y despertar previo de la API en segundo plano.
2. **Formulario por pasos**, armado según la vacante. El borrador se guarda en el navegador, sin el CV.
   1. Contacto + consentimiento de datos (casilla validada y enviada; queda en `consentimientoEn`).
   2. **Eliminatorias primero**, con **declaración jurada**. Si no cumple, se le explica con respeto ("Esta vacante requiere licencia A1"), no se guarda nada y se incrementa `intentosNoCumplen`.
   3. Cuestionario.
   4. CV (PDF) o **mini perfil** (experiencia, estudios, habilidades) si `cvModo = OPCIONAL` + hCaptcha (que se carga recién en este paso).
3. **Envío** con clave de idempotencia. Si ya postuló, mensaje amable con el enlace de seguimiento.
4. **Confirmación:** enlace de seguimiento con botones copiar/compartir y **comprobante en PDF con QR**.
5. **Portal de seguimiento** (`noindex`, `Referrer-Policy: no-referrer`):
   - Etapas en lenguaje amable: *Recibida → En revisión → Entrevista → Proceso finalizado*. "DESCARTADO" nunca se muestra; se usa el `mensajeCierre` de la empresa.
   - La entrevista programada, con la etiqueta de zona horaria ("10:00, hora de Lima").
   - **Retirar mi postulación** y **Solicitar la eliminación de mis datos**: el candidato confirma escribiendo su email. La supresión se ejecuta tras **48 h de gracia**; el retiro lo puede revertir el reclutador. Si hay correo configurado, se envía un aviso.

### 5.2 Reclutador (panel `/app`)

1. **Registro → crear empresa** (nombre, slug, logo, color con control de contraste, zona horaria, locale, textos legales, mensaje de cierre) → **invitar al equipo**. La empresa queda `PENDIENTE`: puede configurarlo todo, pero **no publicar** hasta que el superadmin la verifique.
2. **Crear vacante:** desde una plantilla o con el **asistente IA** (título → propuesta de descripción, criterios con descriptores de nivel y preguntas, todo editable). Va a **Borrador** → **Publicar** → copiar el enlace. Si la IA está desconectada, el asistente ofrece las plantillas. Las propuestas llegan en segundo plano y se avisa cuando están listas.
3. **Lista de postulaciones** en los grupos de §4, con el estado de la IA por fila y "N no cumplieron requisitos" (contador anónimo). **A ciegas** hasta `ENTREVISTA`.
4. **Panel de detalle (Expediente):** veredicto → fortalezas y brechas → criterios con nivel, evidencia y marca de verificada → confianza y banderas → cifra. Acciones disponibles:
   - **Corregir** un nivel: crea una `CorreccionIA` y recalcula.
   - **"Evaluación correcta ✓"**.
   - Notas e historial.
5. **Mover de etapa:** Kanban (arrastrar, teclado o menú "Mover a…") o botones. **Descartar exige un motivo** de la lista de la empresa, más un comentario opcional. Hay **acciones en bloque** (varios candidatos → un motivo → confirmar). Al marcar `CONTRATADO` se pregunta si se cierra la vacante. Si dos personas mueven a la vez (409), aparece "Otra persona movió a este candidato".
6. **Entrevistas:** se agendan con participantes. Cada participante llena su **ficha**: niveles 0–4 por criterio + recomendación. Cada uno ve las fichas ajenas **después de enviar la suya**; OWNER y ADMIN ven todas. Se resaltan los desacuerdos ("Ana: Avanzado en SQL, Luis: Básico").
7. **Analítica:**
   - Embudo de conversión y días promedio por etapa.
   - Tiempo hasta la contratación.
   - Motivos de descarte e intentos que no cumplieron requisitos.
   - **Coincidencia IA–personas**: porcentaje de criterios corregidos.

### 5.3 Revisión a ciegas

- Hasta la etapa `ENTREVISTA` se muestran el **alias aleatorio**, un avatar genérico y el **texto anonimizado**. Una franja permanente lo indica: "Modo a ciegas activo".
- Estas acciones cuentan como **revelar identidad** y quedan en `EventoPostulacion` y `EventoAuditoria`: botón "Revelar", **descargar el PDF** y **buscar por nombre** en ⌘K. En modo a ciegas, ⌘K solo busca por alias o criterio.
- Al llegar a `ENTREVISTA`, la identidad se revela automáticamente (queda registrado).

### 5.4 Permisos por rol

| Acción | OWNER | ADMIN | RECLUTADOR | ENTREVISTADOR |
|---|---|---|---|---|
| Configurar empresa, marca y legal | ✓ | ✓ | — | — |
| Gestionar equipo | ✓ | ✓ (no a OWNER) | — | — |
| Vacantes y postulaciones | ✓ | ✓ | ✓ | — |
| Ver candidatos | todos | todos | todos | solo los de sus entrevistas |
| Fichas ajenas antes de enviar la propia | ✓ | ✓ | — | — |
| Exportar datos de entrenamiento | ✓ | — | — | — |

- No se puede eliminar al último OWNER (verificación dentro de una `$transaction`).
- Superadmin: verificar o suspender empresas, revisar reportes y apagar Google Empleos para una empresa.

---

## 6. Evaluación con IA

### 6.1 Proceso

```
POSTULAR (API, inmediato)                       SERVICIO IA (Python, en segundo plano)
1. Extraer texto (unpdf en worker_thread,       4. Tomar un trabajo (lease)
   10 s / límite de memoria) o mini perfil      5. Prompt: rúbrica con descriptores + declaraciones
2. Legible → limpiar → anonimizar → guardar        + <documento>texto anonimizado</documento>
3. puntajeBase → encolar TrabajoIA              6. Modelo con JSON Schema obligatorio, temperatura 0
                                                7. Validar con código (pydantic + citas + heurísticas)
                                                8. Enviar resultado → la API valida de nuevo con Zod
                                                   y calcula puntajeIA y puntajeFinal (§4)
```

### 6.2 Salida del modelo

```json
{
  "veredicto": "Perfil sólido en SQL y BI; le falta inglés avanzado.",
  "fortalezas": ["..."],
  "brechas": ["..."],
  "criterios": [{ "criterioId": "c1", "nivel": 3, "evidencia": "diseñé dashboards en Power BI para ventas" }],
  "declaraciones": [{ "preguntaId": "p2", "respaldada": false }],
  "confianza": "alta"
}
```

- Escala de **0 a 4 con nombres**: Ninguno · Básico · Intermedio · Avanzado · Experto. Cada criterio incluye descriptores por nivel.
- Respuesta corta: veredicto de 1 frase y citas de 25 palabras como máximo.

### 6.3 Anonimización (en la API, antes de encolar)

1. Reemplazo **exacto** de los valores conocidos del formulario: nombre (completo y por partes), email, teléfono y documento.
2. Expresiones regulares para emails, teléfonos, URLs (incluido LinkedIn) y fechas de nacimiento.
3. Nunca se envían imágenes.
4. Si queda algo dudoso, por ejemplo una parte del nombre dentro de una URL, se marca `ANONIMIZACION_DUDOSA`.

### 6.4 Validación con código

| Regla | Efecto |
|---|---|
| El esquema no se cumple | Reintento. Tras 3 intentos → `FALLIDA` |
| La cita no aparece en el CV (coincidencia aproximada < 90%) | Nivel 0 + `CITAS_FALLIDAS` si es frecuente |
| Nivel ≥ 2 con una cita de menos de 4 palabras o 20 caracteres | Nivel 0 |
| Frases de inyección ("ignora las instrucciones", "puntaje 100"…) | `INYECCION` + revisión manual |
| Texto < 200 caracteres | `SIN_TEXTO`, confianza BAJA |
| Texto > ~6.000 tokens tras limpiarlo | Se recorta + `TRUNCADO`, baja la confianza |
| Declaración no respaldada | `DECLARACION_NO_RESPALDADA`; la interfaz dice "No mencionada en el CV", en color neutro |

**Confianza final** = la menor entre la del modelo, la legibilidad del CV y el porcentaje de citas verificadas.

### 6.5 Modelo

- **Fase 1:** modelo abierto pequeño que siga bien las instrucciones (unos 3B; 7B si hay GPU), servido con Ollama o llama.cpp con salida JSON obligatoria. **No se usan modelos de Anthropic/Claude** (decisión de costo).
- La licencia del modelo queda registrada en la configuración y en cada `EvaluacionIA`. **Antes de cobrar, solo Apache 2.0 o MIT.**
- **`ai:eval`:** unos 30 CV ficticios con la evaluación esperada. Mide la coincidencia de niveles, la correlación del ranking, el porcentaje de citas verificadas y la detección de inyecciones. Es obligatorio aprobarlo antes de cambiar de modelo o de prompt.
- **Fase 2** (con unas 300–500 señales): los ejemplos salen **solo** de correcciones y de "Evaluación correcta ✓" pulsados explícitamente, con texto anonimizado + rúbrica → JSON corregido. Se entrena con QLoRA en Kaggle o Colab → GGUF → Ollama → `ai:eval` contra el modelo base. Si gana, se activa cambiando la versión del modelo.
- **Limitación declarada:** como no se recogen datos demográficos, el sesgo no se puede medir de forma estadística. La defensa es preventiva: anonimizar.

### 6.6 Asistente de vacantes

Es un `TrabajoIA` de tipo `ASISTENTE_VACANTE`: título (+ contexto opcional) → descripción, criterios con descriptores y preguntas sugeridas, todo editable. El resultado llega en segundo plano. Si la IA está desconectada, se ofrecen las plantillas.

---

## 7. Lado público, vistas previas y Google Empleos

### 7.1 Función de metadatos (Vercel)

- Atiende **todas** las visitas a `/{org}/empleos` y `/{org}/empleos/{vacante}`, de personas y robots por igual (**sin cloaking**). Inserta en el `index.html` las etiquetas `<title>`, la descripción, OG/Twitter, la URL canónica y, si corresponde, el JSON-LD `JobPosting`.
- Consulta `GET /public/meta/:org[/:vacante]` en la API con un **secreto compartido** en la cabecera (que le da su propio límite global) y **1,5 s de timeout**. Nunca toca la base.
- **Si la API no responde y no hay caché**: **503 + `Retry-After` + `no-store`**. Una persona ve igual la aplicación y el estado "preparando…"; Google vuelve después sin quitar la oferta.
- **Caché:** vacante `s-maxage=60, stale-while-revalidate=300`; página de empleos con caché más larga; errores y respaldos con `no-store`.
- La **query se ignora** al pedir los datos. Se conservan los parámetros `utm_*`; cualquier otro parámetro → 301 a la URL limpia.
- Slug anterior de la empresa → **301** a la URL nueva.

### 7.2 Respuesta según el estado

| Estado de la vacante | Respuesta |
|---|---|
| ACTIVA | 200 + metadatos + JSON-LD (si es elegible, §7.4) |
| PAUSADA | 200, `noindex`, sin JSON-LD |
| CERRADA o eliminada | 410, `noindex` |
| BORRADOR o inexistente | 404 |
| Empresa `esDemo` | `noindex` en todas sus páginas, nunca JSON-LD |

### 7.3 Seguridad del HTML insertado

- JSON-LD: se escapan `<`, `>`, `&`, U+2028 y U+2029 (como `<`, etc.).
- Atributos de las etiquetas meta escapados.
- La descripción pasa por una lista blanca de HTML (`p`, `ul`, `ol`, `li`, `br`, `strong`, `em`).
- **Logo:** solo PNG, JPG o WebP. Se verifica el tipo real del archivo, se re-codifica y se limita el tamaño. **SVG prohibido.** El logo y la imagen OG se sirven con nombre versionado y caché permanente; sin logo, se usa una imagen por defecto.

### 7.4 Google Empleos: construido, apagado

El JSON-LD se emite **solo si se cumple todo** lo siguiente:

1. `GOOGLE_JOBS_ENABLED=true` en la plataforma.
2. Hay **dominio propio definitivo** verificado en Search Console.
3. El **backend no se duerme** (plan pago).
4. La empresa está `VERIFICADA`, tiene `dominioCorreoVerificado`, no es `esDemo` y tiene `googleJobsHabilitado`. `dominioCorreoVerificado` significa que el correo del dueño es del mismo dominio que `sitioWeb` y que el superadmin comprobó que ese correo existe: con un código enviado por `Correo` si está configurado, o por un contacto aparte. Queda registrado en `EventoAuditoria`.
5. La vacante tiene `publicarEnGoogle`, está ACTIVA y tiene completos los campos obligatorios: título, descripción, `datePosted`, `hiringOrganization` (nombre, `sameAs`, logo) y ubicación (`addressCountry` + localidad) o `TELECOMMUTE` + `applicantLocationRequirements` si es REMOTO.

Además:

- `validThrough` = `fechaCierre`. Si no hay fecha, vence a los 60 días (`validoHasta`) y se avisa al reclutador. **Renovar** solo extiende `validoHasta`; **`datePosted` nunca cambia**.
- Si faltan campos, la vacante se publica igual sin marcado y el reclutador ve qué completar.
- `directApply: true` (se postula en la propia página). Salario opcional.
- La interfaz dice "Publicada con datos estructurados", **nunca** "Visible en Google".
- **Reportar vacante:** formulario público con hCaptcha y límite de peticiones → `Reporte`. Varios reportes sobre una empresa generan una alerta al superadmin, que puede suspender a la empresa o apagar su Google Empleos.

### 7.5 Indexación

- `robots.txt` del dominio web: permite `/*/empleos`; bloquea `/app`, `/seguimiento` y `/api`. La API responde con `X-Robots-Tag: noindex` en todo.
- Sitemap índice + sitemap por empresa con `lastmod`, que incluye **solo** las vacantes elegibles.
- La Indexing API queda fuera de la v1.

Las vistas previas para WhatsApp y LinkedIn **no** tienen estas restricciones y funcionan desde la demo.

---

## 8. Errores y seguridad

### 8.1 Formato de error

```ts
{ error: { code: CodigoError, message: string, details?: unknown, requestId: string } }
```

- `CodigoError` es un catálogo compartido en `packages/shared`: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VERSION_CONFLICT`, `DUPLICATE`, `HAS_DEPENDENCIES`, `VACANTE_CERRADA`, `ORG_NO_VERIFICADA`, `RATE_LIMITED`, `CAPTCHA_FAILED`, `ARCHIVO_INVALIDO`, `YA_POSTULASTE`, `INTERNAL`…
- El frontend traduce el código según el locale de la empresa. `message` se usa solo si no hay traducción.
- Errores de Prisma: P2002 → 409 `DUPLICATE`, P2025 → 404, P2003 → 409 `HAS_DEPENDENCIES`. Un 500 nunca expone detalles internos.
- `requestId` en la cabecera `X-Request-Id`, en los logs y en el cuerpo del error.
- **Logs:** pino en JSON, que oculta email, teléfono, documento, texto de CV, tokens y cookies. El worker sigue la misma regla.
- **Frontend:** control de errores por ruta, errores de campo a partir de `details`, toasts para acciones fallidas y reversión del cambio optimista ante un 409.

### 8.2 Topología de cookies y orígenes

- **`/api/*` pasa por el rewrite de Vercel**, así la cookie de sesión queda en el **mismo sitio** que la web. Con dominio propio (`app.` y `api.` del mismo dominio) se puede ir directo.
- La API **rechaza `/api/*` sin el secreto de edge**. La IP real se toma de la cabecera de Vercel y solo se confía en ella si viene con el secreto.
- **`/public/*` va directo a Render**: no usa cookies, CORS solo permite el origen de la web y se aplica `trust proxy 1`. Así se evita el límite de unos 4,5 MB del proxy para los CV.
- `/internal/*` va directo, solo con token de servicio. `/health` es público y no toca la base.

### 8.3 Controles

- **Autenticación:**
  - bcrypt con costo 12 y mínimo 10 caracteres.
  - Cookie de sesión `httpOnly`, `Secure`, `SameSite=Lax`, 12 h. CSRF con doble envío del token + verificación de `Origin`.
  - Límite de inicios de sesión **por IP y por correo**.
  - Mismo mensaje y mismo tiempo tanto si el correo existe como si no (se compara contra un hash falso). Lo mismo en recuperación de contraseña y en "ya postulaste".
- **CAPTCHA (hCaptcha):** se verifica en el backend con 5 s de timeout. En desarrollo y E2E se usan las **claves de prueba oficiales**. **No hay atajo por token.** La API **no arranca** en producción con claves de prueba.
- **Límites de peticiones:**
  - Inicio de sesión: 20 cada 15 min por IP + límite por correo.
  - Postular: **30 por hora por IP** (por el CGNAT de los operadores móviles) + límite por email y vacante.
  - Reportes: con CAPTCHA.
  - `/public/meta`: límite global aparte, con secreto.
- **Archivos:**
  - PDF: primeros bytes `%PDF-`, máximo 5 MB y 10 páginas. Extracción con `unpdf` en un `worker_thread` con 10 s y límite de memoria. Si falla, la postulación se guarda igual con `SIN_TEXTO`.
  - El CV se descarga siempre como archivo (`attachment` + `nosniff`) y requiere sesión.
  - Imágenes: según §7.3.
- **Cabeceras:**
  - helmet en la API.
  - CSP estricta en la web: scripts propios y de hCaptcha, `frame-ancestors 'none'`. El color de la empresa se aplica desde JavaScript (CSSOM), sin estilos en línea.
  - `Referrer-Policy: no-referrer` en el seguimiento.
- **Validación:** Zod en todos los bordes (body, query, params, resultados del worker). Límites de longitud en todos los campos públicos.
- **Auditoría:** `EventoAuditoria` (§3.5).
- **Secretos:**
  - Variables de entorno + `.env.example`.
  - **gitleaks** en el pre-commit y en la CI.
  - `npm audit`, `pip-audit` y Dependabot.
  - **Nunca se documentan contraseñas en el repo.**
- **Respaldos:** `pg_dump` semanal **cifrado** antes de salir del servidor.
- **Privacidad (Ley 29733 y similares):**
  - La empresa es la **responsable** de los datos; Criterio es la **encargada** (cláusula en los términos).
  - La política declara la **transferencia internacional** (Neon en EE. UU.) y dónde se procesa la IA.
  - Retención por empresa con anonimización automática. Derechos ARCO desde el portal de seguimiento.
  - **Nunca se usan datos reales en el desarrollo.**

### 8.4 Correo transaccional mínimo

Interfaz `Correo` con estos adaptadores:

- `consola` y Mailpit en desarrollo.
- **Brevo** en producción.

**Solo** se usa para tres casos:

- Invitación al equipo.
- Recuperar la contraseña.
- Aviso de retiro o supresión.

**Si el correo no está configurado:**

- La invitación genera un enlace para copiar.
- Un ADMIN puede generar un enlace de un solo uso para restablecer la contraseña.
- El retiro y la supresión funcionan sin aviso por correo.

Los correos de notificación por etapa quedan fuera de la v1.

---

## 9. Restricciones técnicas de la interfaz

El aspecto visual se define en la fase UX/UI (§1.4). Estas restricciones son fijas:

- **Stack:** React 19, Vite (versión estable actual), TypeScript, **Tailwind 4** (`@theme` sobre variables CSS), shadcn/ui (Radix), TanStack Table, TanStack Query, dnd-kit, FullCalendar, Recharts, Lucide y Sonner.
- **Variables de diseño semánticas** (`--surface`, `--text-muted`, `--accent`, `--accent-soft`…).
- **Color de acento por empresa:** se verifica el contraste **WCAG AA (4,5:1)**. Si no alcanza, se oscurece en **OKLCH** sin cambiar el tono y se muestra la vista previa. Los tonos derivados se calculan a partir de ese color.
- **Puntajes nunca en rojo** y siempre con etiqueta de texto (Avanzado, Básico…). El rojo es para errores; el ámbar, para banderas.
- **Público pensado primero para celular** (≤ 150 KB comprimidos, controlado en la CI). **Panel pensado primero para escritorio**; en el celular, el Kanban pasa a ser una lista.
- **Código dividido por ruta:** calendario, gráficos y Kanban se cargan al abrirse; hCaptcha, en el último paso.
- **Fuentes servidas desde el propio sitio** (`@fontsource`, WOFF2 con solo los caracteres necesarios). La tipografía final se elige en la fase UX/UI.
- **Accesibilidad:**
  - Kanban usable con teclado + menú "Mover a…".
  - `aria-live` para los cambios de estado de la IA.
  - axe en las pruebas E2E.
- **Sin destello de tema:** esqueleto neutro hasta recibir la marca (una petición con caché por ETag).
- **Estados explícitos**: nunca una pantalla en blanco ("Despertando el servidor, unos 30 s", "8 esperando evaluación", "IA desconectada").
- **Fechas y números con `Intl`** según el locale y la zona horaria de la empresa. Horas siempre con la etiqueta de zona.
- **Cambio de empresa visible:** cambia el color de acento y el nombre en la barra.
- **Pantallas:**
  - Panel: Inicio · Vacantes · Detalle de vacante · Tablero · Entrevistas y fichas · Analítica · Ajustes (marca, equipo, plantillas, motivos, legal) · Superadmin.
  - Lado público: empleos · vacante · formulario · confirmación · seguimiento · privacidad.

---

## 10. Pruebas

| Nivel | Herramienta | Cubre |
|---|---|---|
| Unitarias | Vitest · pytest | `puntaje.ts` (incluida la regla del dato faltante), anonimización, verificación de citas, validadores, slugs, escapado del JSON-LD, contraste OKLCH |
| Integración | Vitest + Supertest + Postgres real | Rutas, transacciones, bloqueo optimista, máquina de estados de la IA, `SKIP LOCKED`, lease, reparto justo |
| **Aislamiento entre empresas** | Suite generada | Recorre todas las rutas registradas: crea en A, pide como B y espera 404. **Una ruta sin clasificar rompe la CI** |
| Contrato API ↔ worker | Zod → JSON Schema → pytest | El worker valida su salida contra el esquema exportado |
| IA | `ai:eval` (a mano) · modelo falso (CI) | Calidad del modelo antes de cambiarlo · circuito completo de forma determinista |
| E2E | Playwright + axe | El candidato postula (celular y escritorio, claves de prueba de hCaptcha). El reclutador crea, publica, revisa, descarta con motivo, agenda y llena la ficha. **El modo a ciegas no deja el nombre en ninguna parte de la página.** Sin violaciones de axe |
| Seguridad | Integración | CSRF, atributos de la cookie, archivo falso con `.pdf`, PDF malicioso cortado por tiempo, XSS, logo SVG rechazado, límites de peticiones, `/api` sin secreto de edge, arranque con claves de prueba de hCaptcha en producción |
| Lado público | Integración | 410 para vacante cerrada, empresa demo sin JSON-LD, 503 con la API caída, redirección de query y de slug anterior |
| Presupuesto | size-limit | Código público ≤ 150 KB comprimidos |

**Entorno:**

- Pruebas locales contra una base `criterio_test` en el Postgres local, **sin Docker**.
- CI con un contenedor de Postgres de GitHub Actions.
- Modelo falso en la CI; `ai:eval` a mano.

**CI (GitHub Actions):**

- eslint y ruff.
- tsc.
- Pruebas unitarias y de integración.
- gitleaks y auditoría de dependencias.
- size-limit.
- `prisma migrate diff`.
- E2E en los PR hacia `main`.

**Cobertura:** no se exige un porcentaje global; sí **≥ 90%** en `puntaje`, aislamiento, anonimización y citas. La lógica de negocio se escribe con TDD.

---

## 11. API (resumen por módulo)

```
AUTH         POST /api/auth/registro · /login · /logout · /cambiar-empresa · /restablecer · /restablecer/confirmar
             GET  /api/auth/yo
ORGS         GET/PUT /api/organizacion · POST /api/organizacion/logo
             GET/POST/PATCH/DELETE /api/organizacion/miembros · POST /api/organizacion/invitaciones
             GET/POST/PUT/DELETE /api/plantillas · /api/motivos-descarte
VACANTES     GET/POST /api/vacantes · GET/PUT/DELETE /api/vacantes/:id
             POST /api/vacantes/:id/publicar · /pausar · /cerrar · /duplicar · /reevaluar · /renovar
             POST /api/vacantes/asistente  (→ TrabajoIA)
POSTULACIONES GET /api/vacantes/:id/postulaciones (grupos §4) · GET /api/postulaciones/:id
             PATCH /api/postulaciones/:id/etapa (version) · POST /api/postulaciones/acciones-bloque
             POST /api/postulaciones/:id/notas · /revelar · /reintentar-ia · /evaluacion-manual
             GET  /api/postulaciones/:id/cv  (cuenta como revelar si está a ciegas)
EVALUACION   POST /api/evaluaciones/:id/correcta · /api/evaluaciones/criterios/:id/correccion
ENTREVISTAS  GET/POST /api/entrevistas · PUT/DELETE /api/entrevistas/:id
             GET/PUT /api/entrevistas/:id/ficha · POST /api/entrevistas/:id/ficha/enviar
ANALITICA    GET /api/analitica/embudo · /tiempos · /motivos · /coincidencia-ia
IA           GET /api/ia/estado
SUPERADMIN   GET /api/superadmin/organizaciones · POST /:id/verificar · /suspender · /google
             GET /api/superadmin/reportes
PUBLICO      GET /public/:org/empleos · /public/:org/vacantes/:slug · /public/meta/:org[/:slug]
             POST /public/:org/vacantes/:slug/verificar-eliminatorias · /postular
             GET/POST /public/seguimiento/:token · /retirar · /suprimir · GET /comprobante.pdf
             POST /public/reportes
INTERNO      POST /internal/trabajos/tomar · /internal/trabajos/:id/resultado · /internal/latido
SISTEMA      GET /health
```

---

## 12. Qué se reutiliza de GLONIS

Se reutilizan las **reglas**, no los archivos:

- Limpieza de archivos subidos en cada salida temprana.
- Validación antitrampa del cuestionario (deduplicar, ids exactos).
- Archivos guardados en la base de datos para Render sin disco.
- `trust proxy`.
- Lógica del último administrador dentro de una transacción.
- `Cache-Control: no-store` en la vacante pública.
- Helmet y límites de peticiones.
- Sanitizado de `Content-Disposition`.
- Fetch con sesión para descargar el CV.

El código de Criterio se escribe desde cero en el monorepo. El `CLAUDE.md` de GLONIS se **reemplaza** por uno de Criterio.

---

## 13. Fases de implementación (orientativas; el detalle va en el plan)

0. **Base:** monorepo, CI, `packages/shared`, Prisma con el modelo, extensión multiempresa, suite de aislamiento, formato de errores y logs.
1. **Cuentas:** registro, empresas, membresías, invitaciones, cookie + CSRF, superadmin y verificación.
2. **Vacantes:** CRUD, criterios, preguntas, plantillas, bloqueo, publicar y duplicar.
3. **Postulación pública:** eliminatorias, cuestionario, PDF o mini perfil, CAPTCHA, anonimización, puntaje base, seguimiento y comprobante.
4. **Servicio de IA:** cola, endpoints internos, worker de Python, validación, `ai:eval` y asistente.
5. **Fase de diseño UX/UI** (puede avanzar en paralelo con 1–4).
6. **Panel:** lista por grupos, Expediente, a ciegas, Kanban, acciones en bloque, correcciones y evaluación manual.
7. **Entrevistas y fichas.**
8. **Analítica.**
9. **Lado público para compartir:** función de metadatos, OG, sitemap y JSON-LD (apagado).
10. **Correo transaccional, retención, supresión, respaldos y cierre de seguridad.**
11. **Mudanza al repositorio nuevo y despliegue.**

---

## 14. Riesgos abiertos y límites conocidos

- **Lentitud de la IA en CPU** (≈45 s por CV con 3B): se acepta para la demo porque nunca bloquea el proceso.
- **Sesgo:** no se puede medir de forma estadística sin datos demográficos; la mitigación es preventiva.
- **Dependencia de planes gratuitos:** Render se duerme, Neon tiene 0,5 GB y Vercel Hobby es no comercial. Las condiciones para cobrar y para activar Google Empleos quedan documentadas.
- **Dominio:** "criterio" es una palabra común; definirlo antes de activar Google Empleos.
- **Correo con remitente verificado sin dominio propio:** entregabilidad limitada. Un dominio propio la mejora.

---

## 15. Decisiones tomadas al consolidar (para revisar)

No se discutieron por separado en la sesión; surgieron al unir las secciones:

1. **Evaluación manual** (`EvaluacionIA.origen = MANUAL`): las postulaciones con IA fallida o confianza baja no quedan atascadas fuera del ranking; el reclutador puede evaluarlas a mano.
2. **Fichas de entrevista con la misma escala 0–4 con nombres** que la IA (antes 1–5), para que la rúbrica sea una sola.
3. **Tabla de permisos por rol** (§5.4): el ENTREVISTADOR solo ve a los candidatos de sus entrevistas y solo el OWNER exporta datos de entrenamiento.
4. **Identidad revelada automáticamente al llegar a `ENTREVISTA`**, con registro.
5. **TanStack Query** para manejar los datos del servidor en el frontend.
6. **Sesión de 12 h** (antes 8 h), invalidable con `Membresia.version`.
7. **Motivos de descarte configurables** por empresa (`MotivoDescarte`), con una lista inicial.
8. **El latido del worker y el indicador de pendientes viven solo en memoria**, para no despertar a Neon.
