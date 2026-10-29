---
title: 'Race administration and participant invitations (backend)'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '3c0c4b9cd47b77851984e37585565b470dda6e00'
context:
  - '{project-root}/_bmad-output/specs/spec-alleycat-safety/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-alleycat-safety/product-and-domain.md'
  - '{project-root}/_bmad-output/specs/spec-alleycat-safety/safety-and-privacy.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Organizers of an alleycat race cannot yet define the race and its unordered checkpoints or invite the people who will participate. Without that foundation, no later rider registration, GPS tracking, emergency workflow, or QR check-in can be tied to an authorized race.

**Approach:** Deliver the first vertical slice: an authenticated organizer can create, edit, publish, and view a race; place named checkpoint pins without ordering them; and issue trackable invitations. Invitees can open an invitation and see the race they were invited to, but their profile, emergency data, participation session, live location, alerts, and QR check-ins remain deferred.

**Decisions:** The product is a responsive Web/PWA. Administrators authenticate through email magic links. The administrator maintains a basic roster of pre-registered riders (name plus email and/or phone); an invitation grants one listed rider access to one race and does not create a public self-registration path. Each invitation uses a hashed, expiring, single-use, revocable link; the administrator may deliver it by email or copy it for WhatsApp. The application uses an SMTP-configured email adapter in deployed environments and exposes a development-only delivery preview locally. PostgreSQL is the production database, and the application will deploy on Railway.

**Decisiones de revisión (2026-10-28, renegociadas por el humano):**
- **Roles:** existe un único superadmin, el dueño del producto, identificado por `SUPERADMIN_EMAIL`. Sólo el superadmin crea cuentas de admin. Los admins y el superadmin pueden crear carreras y gestionar su propio padrón de corredores. Nadie se da de alta solo: un email que no pertenece a una cuenta existente (ni es `SUPERADMIN_EMAIL`) nunca obtiene enlace mágico.
- **Un solo uso:** la invitación se consume al registrarse el corredor, en una entrega posterior. En esta entrega puede reabrirse hasta que expire o se revoque. El estado `used` existe en el modelo pero nada lo asigna todavía.
- **Alcance de esta spec (split 2026-10-28):** backend, API, tests y despliegue. La UI web (editor, panel de invitaciones, sección de superadmin y vista del invitado) va en una spec aparte registrada en `deferred-work.md`.
- **Checkpoints:** mientras la carrera está en borrador, el organizador puede borrar un checkpoint. Para moverlo se borra y se vuelve a colocar.

## Boundaries & Constraints

**Always:** Preserve the unconstrained alleycat route: checkpoints belong to a race but have no visit sequence. Keep published race data race-scoped. Model invitations as individual, expiring, single-use records with an auditable state. Restrict management views and invite data to authenticated administrators. Show whether an invitation was sent, opened, expired, or revoked; participant registration and acceptance are deferred. La vista previa de enlaces sólo existe con `APP_ENV=development` explícito; cualquier otro valor, o su ausencia, la desactiva.

**Never:** Do not collect emergency or medical data, request camera/GPS permissions, start location sharing, expose a public race roster, calculate routes or scores, implement incident alerts, or accept QR check-ins in this increment. Do not allow a participant to discover or join a race without a valid invitation. No exponer un endpoint de alta de organizadores sin autenticación de superadmin. No revelar si un email tiene cuenta.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Create a draft race | Authenticated administrator provides a name, start area, and start/end time | A race is stored as `draft`, attributed to that administrator, and opens for checkpoint editing | Reject a blank name, invalid coordinates, or an end time not after the start time with field-specific feedback |
| Place unordered checkpoints | Draft race with a selected map location and checkpoint label | A checkpoint is saved and displayed on the race map; no ordering field or sequence validation exists | Reject an invalid coordinate without altering existing pins |
| Borrar checkpoint | Carrera en borrador y checkpoint propio | El checkpoint desaparece del mapa y de la lista | Rechazar si la carrera está publicada o es de otro organizador |
| Publish race | Complete draft race with at least one checkpoint | Race becomes visible through a valid invitation and can receive invitations | Block publishing with an explanation if required race data or checkpoints are missing |
| Pedir enlace mágico | Email de una cuenta existente o igual a `SUPERADMIN_EMAIL` | Se envía el enlace; la primera vez se crea la cuenta superadmin | Un email desconocido recibe la misma respuesta genérica y no se envía ni se crea nada |
| Crear admin | El superadmin envía el email de un admin nuevo | Se crea la cuenta admin, que ya puede pedir su enlace | Rechazar a quien no sea superadmin (403); un email duplicado da 409 |
| Issue an invitation | Published race plus recipient identity via the selected channel | A unique, expiring invitation is created and its delivery attempt/status appears in the organizer view | Do not issue a second active invitation for the same recipient and race; offer resend or revoke instead |
| Open invitation | Valid unexpired invitation link | Invitee sees only the intended race summary and an action to continue registration in a later slice | Show a safe expired, revoked, used, or invalid state without revealing race details |

</frozen-after-approval>

## Code Map

- `_bmad-output/specs/spec-alleycat-safety/{SPEC,product-and-domain,safety-and-privacy}.md`: contrato de capacidades, entidades y restricciones de acceso.
- Rama `review/slice1-snapshot` (`063d995`): implementación previa revertida. Para reutilizarla, leerla con `git show review/slice1-snapshot:<ruta>`. Conservar lo indicado en KEEP (Spec Change Log) y corregir lo que lista el Review Triage Log.
- `backend/app/`: FastAPI. `main.py` sólo monta los routers y la web estática. `routers/{auth,admin,races,invitations}.py`, `services/{magic_links,invitations,races,mailer}.py`, `models.py`, `database.py`, `security.py`.
- `backend/alembic/` + `backend/alembic.ini`: una sola migración inicial que coincide con `models.py`; `env.py` usa `app.database.DATABASE_URL`.
- `Dockerfile` (raíz) y `railway.toml` (raíz): un solo servicio Railway. La API sirve `web/dist` si existe; la spec de UI añadirá la etapa de build de la web.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/models.py`, `backend/app/database.py`, `backend/alembic/` -- añadir `Organizer.role` (`superadmin`|`admin`) y el email en minúsculas y único. Normalizar `postgres://` y `postgresql://` a `postgresql+psycopg://`. Usar fechas UTC aware (`DateTime(timezone=True)`) -- persistencia correcta en Railway.
- [x] `backend/app/routers/auth.py`, `backend/app/routers/admin.py`, `backend/app/services/magic_links.py`, `backend/app/services/mailer.py` -- enlace mágico sólo para cuentas existentes o `SUPERADMIN_EMAIL`, con respuesta genérica. `POST/GET /admin/organizers` sólo para superadmin. Asunto y cuerpo del email según el tipo. Preview sólo con `APP_ENV=development` -- control de acceso del superadmin sin enumerar cuentas.
- [x] `backend/app/routers/races.py`, `backend/app/services/races.py` -- reglas de borrador, edición y publicación. `DELETE /races/{id}/checkpoints/{cid}` sólo en borrador. Validar nombre de corredor no vacío -- alleycat sin orden, con corrección de pins.
- [x] `backend/app/routers/invitations.py`, `backend/app/services/invitations.py` -- emitir, reenviar, revocar y abrir invitaciones. El estado se deriva en este orden: `used` → `expired` (por fecha o `delivery_status`) → `revoked` → `opened` → `sent` -- estado auditable y fiel.
- [x] `backend/app/main.py` -- montar los routers y servir `web/dist`, si existe, con fallback a `index.html` para los GET que no son de la API -- mismo origen, cookie Lax válida y rutas SPA funcionando.
- [x] `backend/tests/` -- cubrir cada fila de la matriz y además: producción sin preview, reinvitar tras expirar, enlace mágico reutilizado o expirado, sesión expirada, organizador ajeno (revocar o reenviar, invitar a un corredor ajeno), admin creado por quien no es superadmin, email desconocido -- protege las fronteras de seguridad.
- [x] `Dockerfile`, `railway.toml`, `DEPLOYMENT.md` -- imagen de la API desde la raíz (`uv sync --frozen`). El arranque ejecuta `alembic upgrade head` y uvicorn en `$PORT`. Variables documentadas: `DATABASE_URL`, `APP_ENV`, `PUBLIC_APP_URL`, `SUPERADMIN_EMAIL`, `SMTP_*` -- desplegable en un solo servicio.

**Acceptance Criteria:**
- Given an authenticated organizer, when they create a race with valid schedule and start area, then they can save it as a private draft associated only with their account.
- Given a draft race, when the organizer adds checkpoints in any sequence, then the API stores and returns all pins without imposing or persisting a visit order.
- Given a pre-registered rider, when the organizer selects email or WhatsApp delivery, then the product creates the same secure invitation link and either sends it through email or makes it available to copy without creating a second active invitation.
- Given a different administrator or unauthenticated visitor, when they request a race or invitation they do not own, then the product denies access.
- Dado un despliegue sin `APP_ENV=development`, cuando alguien pide un enlace mágico o una invitación, entonces la respuesta nunca incluye el enlace.

## Implementation Notes

## Spec Change Log

- **2026-10-28, iteración 1.** Detonantes: I1 (cualquiera se volvía organizador), I2 (single-use ambiguo), I3 (no se podía borrar un checkpoint) y B1 (web y API en sitios distintos, sin fallback SPA ni root del Dockerfile). Cambios: decisiones de roles, de un solo uso y de checkpoints en el bloque frozen, renegociadas por el humano. Despliegue en un solo servicio y mismo origen. Tareas ampliadas con los parches P1–P16 del triage. Estado malo que se evita: toma de cuentas por alta abierta o preview fail-open, cookie que no viaja, y build de Railway sin contexto. **KEEP:** tokens con hash (`security.py`), enlaces mágicos de 15 min y un solo uso, sesión HttpOnly de 7 días; índice parcial `one_active_invitation` con `IntegrityError` → 409; barrido de expiradas y `replaced` en `issue()`; `race_for` como guarda de propiedad; mensajes de error 404 seguros que no revelan la carrera; `mapUtils.pinsForDisplay` y su test; los tests llaman directamente a los handlers (TestClient se bloquea en Py3.14); textos del editor ("Pins are unordered…").

## Review Triage Log

Revisión del 2026-10-28, iteración 1. Capas: Blind Hunter (BH), Edge Case Hunter (ECH) y Verification Gap (VG). Diff desde `3c0c4b9`.

| # | Capa | Hallazgo | Veredicto | Evidencia | Ruta |
|---|---|---|---|---|---|
| 1 | VG | No hay test de que en producción no se devuelva el enlace mágico | medium | Gap pre-verificado: ningún test fija `APP_ENV`/`SMTP_HOST` | patch (P1) |
| 2 | VG | No hay test de reinvitar tras expirar | medium | Gap pre-verificado: `test_lifecycle.py` no reinvita tras retroceder `expires_at` | patch (P2) |
| 3 | VG | El índice parcial de la migración no se ejercita | medium | Gap pre-verificado: los tests usan `create_all`, no Alembic | defer (D1) |
| 4 | VG | `postgresql://` cae en psycopg2, que no está instalado | high | `database.py:5` sólo reescribe `postgres://`; `pyproject` sólo trae psycopg v3; `env.py` usa la misma URL | patch (P3) |
| 5 | VG | Cookie `SameSite=Lax` con web y API en sitios distintos | high | `auth.py:36` lax + `client.ts` credentials include; DEPLOYMENT.md despliega web y API como servicios separados (`*.up.railway.app` está en la PSL) | bad_spec (B1) |
| 6 | VG | Las invitaciones expiradas o reemplazadas aparecen como "revoked" | medium | `invitations.py:53`: `not item.active` se evalúa antes que la expiración | patch (P4) |
| 7 | VG | Cualquier email crea un Organizer | high | `auth.py:49` crea la cuenta sin restricción | intent_gap (I1) |
| 8 | VG | `... or relative` es código muerto | low | f-string nunca vacía en `invitations.py:19` y `auth.py:51`; el arreglo es borrar | patch (P5) |
| 9 | BH | La vista previa del enlace queda activa si falta `APP_ENV` | medium | `mailer.py:7` usa `development` por defecto (fail-open); DEPLOYMENT.md sí exige `APP_ENV=production`, pero un olvido filtra credenciales | patch (P1) |
| 10 | BH | Organizadores abiertos, sin rate limit; duplicado en `/auth/organizers` da 500 | high | `auth.py:43-49`: la intención no define quién puede ser administrador | intent_gap (I1) |
| 11 | BH | Cookie en sitios cruzados | high | Igual que #5 | bad_spec (B1) |
| 12 | BH | La invitación nunca es de un solo uso | medium | Ningún código asigna `used_at`; `open_invite` puede reabrirse indefinidamente. La intención dice single-use y la aceptación está diferida: ambigua | intent_gap (I2) |
| 13 | BH | Docker: `alembic.ini` sin seguimiento | false | Los archivos existen y no están ignorados; sólo falta el `git add` del commit | rechazado |
| 14 | BH | Docker ignora `uv.lock` | low | No es reproducible, pero el arreglo cambia la estrategia de build y rara vez se nota | rechazado |
| 15 | BH | `CMD` con puerto 8080 frente a `$PORT` | false | `startCommand` de `railway.toml` sustituye al `CMD` | rechazado |
| 16 | BH | Las fechas se desplazan por la zona horaria en cada guardado | medium | `RaceEditor.tsx` usa `toISOString().slice(0,16)` (UTC) como `defaultValue` local | patch (P6) |
| 17 | BH | Mezcla aware/naive provoca TypeError | false | El cliente siempre envía ambas fechas con `Z`; pydantic las parsea aware a las dos | rechazado |
| 18 | BH | No se puede borrar ni corregir un checkpoint | medium | No hay endpoint; un pin mal puesto obliga a recrear la carrera. La intención no lo define | intent_gap (I3) |
| 19 | BH | No hay logout ni despublicar | low | Rara vez bloquea; añade endpoints | rechazado |
| 20 | BH | Errores de publicar, pin o editar sin feedback | medium | `main.tsx`: `onPin`/`onPublish`/`onEdit` sin try/catch | patch (P7) |
| 21 | BH | Falta rewrite SPA para `/invite/*` y `/auth/consume/*` | medium | DEPLOYMENT.md dice "static service" sin fallback a `index.html` | bad_spec (B1) |
| 22 | BH | No es PWA: falta viewport, doctype y title | medium | `web/index.html` sólo tiene `#root` y el script; sin viewport no es responsive en móvil | patch (P8) |
| 23 | BH | Falta manifest y service worker | low | Ningún flujo de esta entrega depende de instalar o funcionar offline; añade archivos | rechazado |
| 24 | BH | El email de enlace mágico dice "invitation" | low | `mailer.py:17-18` usa asunto fijo; se ve en cada inicio de sesión | patch (P9) |
| 25 | BH | Se envía el email antes del commit | low | Sólo se da con commit fallido por carrera concurrente; el arreglo reordena estado | rechazado |
| 26 | BH | `or relative` muerto | low | Igual que #8 | patch (P5) |
| 27 | BH | Faltan tests de acceso: reutilizar/expirar enlace mágico, sesión expirada, organizador ajeno | medium | La tarea de la spec afirma cobertura de autorización y use-once; no existen esos tests | patch (P10) |
| 28 | BH | La BD de test en `/tmp` no se borra | low | Molestia de desarrollo; rechazado | rechazado |
| 29 | BH | Deriva entre modelo y migración; sin `target_metadata` | low | `active = 1` y `active` son equivalentes en SQLite; autogenerate no se usa | rechazado |
| 30 | BH | No se carga al entrar; la lista muestra "Rider #id" | low | Se ve a diario; el nombre puede salir del roster ya cargado, sin tocar la API | patch (P11) |
| 31 | BH | `router.tsx` es código muerto | low | `isInviteRoute` no se usa; `main.tsx` enruta inline | patch (P12) |
| 32 | BH | Documentos de estado contradictorios | low | RESUME.md dice in-progress, 2 tests y endpoints en `main.py`, todo falso | patch (P13) |
| 33 | BH | `mailto` placeholder en la landing | low | La landing está fuera de esta spec y necesita un email real del usuario | rechazado |
| 34 | ECH | `postgresql://` → psycopg2 | high | Igual que #4 | patch (P3) |
| 35 | ECH | Vista previa con `APP_ENV` sin definir | medium | Igual que #9 | patch (P1) |
| 36 | ECH | Auto-alta de organizadores | high | Igual que #7 | intent_gap (I1) |
| 37 | ECH | `/auth/organizers` abierto y duplicado da 500 | high | `auth.py:43-45` | intent_gap (I1) |
| 38 | ECH | Mayúsculas en el email crean cuentas duplicadas | low | `Owner@x` ≠ `owner@x`; se arregla con `strip().lower()` | patch (P14) |
| 39 | ECH | `PUBLIC_APP_URL` sin definir da enlaces relativos | low | Igual que #8 | patch (P5) |
| 40 | ECH | SameSite | high | Igual que #5 | bad_spec (B1) |
| 41 | ECH | Consumo concurrente del enlace mágico crea dos sesiones | low | Requiere poseer ya el enlace y una carrera de milisegundos; el arreglo es un guard | rechazado |
| 42 | ECH | Un fallo SMTP da 500 sin estado `failed` | false | Fallo ruidoso: se hace rollback y no persiste nada inconsistente | rechazado |
| 43 | ECH | Email antes del commit | low | Igual que #25 | rechazado |
| 44 | ECH | Una invitación previa con `used_at` bloquea con 409 falso | false | Ningún código asigna `used_at`; inalcanzable | rechazado |
| 45 | ECH | Expirada mostrada como revoked | medium | Igual que #6 | patch (P4) |
| 46 | ECH | Reenvío concurrente da 500 | low | Doble clic simultáneo improbable; añade try | rechazado |
| 47 | ECH | El reenvío recalcula la expiración en horas | low | Trunca o extiende a 1 h; impacto mínimo; cambia la firma | rechazado |
| 48 | ECH | Mensaje "already revoked" engañoso | low | Raro y cosmético | rechazado |
| 49 | ECH | TypeError aware/naive | false | Igual que #17 | rechazado |
| 50 | ECH | Corredor con nombre en blanco | low | `races.py:106` no valida el nombre; arreglo de una línea | patch (P15) |
| 51 | ECH | `RaceEditor` sin `key` | high | Inputs no controlados: al cambiar de carrera se guardan los datos de A sobre B | patch (P16) |
| 52 | ECH | `InvitationPanel` obsoleto al cambiar de carrera | medium | `refresh` sólo se ejecuta con el botón | patch (P11) |
| 53 | ECH | Desplazamiento por zona horaria | medium | Igual que #16 | patch (P6) |
| 54 | ECH | Rechazo sin manejar en `onPin` | medium | Igual que #20 | patch (P7) |
| 55 | ECH | `detail` 422 en array muestra `[object Object]` | medium | `client.ts`: el 422 de FastAPI trae una lista | patch (P7) |
| 56 | ECH | `railway.toml` en la raíz y Dockerfile en `backend/` | high | No hay `dockerfilePath` ni root directory; el build de Railway no encuentra el contexto | bad_spec (B1) |
| 57 | ECH | `SMTP_HOST` en el entorno rompe los tests | low | Se arregla junto con P1 (los tests fijan su entorno) | patch (P1) |
| 58 | ECH | Afirmación single-use | medium | Igual que #12 | intent_gap (I2) |
| 59 | ECH | Afirmación de administradores autenticados | high | Igual que #7 | intent_gap (I1) |
| 60 | ECH | Afirmación de preview sólo en desarrollo | medium | Igual que #9 | patch (P1) |
| 61 | ECH | Afirmación de feedback por campo | medium | Igual que #20 | patch (P7) |
| 62 | ECH | Afirmación de estado expired | medium | Igual que #6 | patch (P4) |

**Grupos con loopback:**
- **I1, intent_gap (high):** quién puede ser organizador.
- **I2, intent_gap (medium):** qué significa "de un solo uso" mientras el registro está diferido.
- **I3, intent_gap (medium):** corrección o borrado de checkpoints en borrador.
- **B1, bad_spec (high):** topología de despliegue en Railway. Faltan web y API en el mismo sitio, el fallback SPA y el root o `dockerfilePath` del backend.

Revisión del 2026-10-28, iteración 2 (backend re-derivado). Diff: `review-diff-iter2.patch`.

| # | Capa | Hallazgo | Veredicto | Evidencia | Ruta |
|---|---|---|---|---|---|
| 63 | VG | La migración no se prueba contra los modelos | carried medium | Mismo hallazgo que #3: `create_all` en los tests | carried defer (D1) |
| 64 | VG | El reenvío no comprueba que se conserve `expires_at` | medium | Gap pre-verificado: ningún test lee `expires_at` tras `resend` | patch (P25) |
| 65 | VG | La guarda de email vacío del bootstrap no tiene test | high | Gap pre-verificado: sin `email and` y con `SUPERADMIN_EMAIL` vacío, cualquiera crea un superadmin | patch (P25) |
| 66 | VG | Ni el fallback SPA ni su guarda de traversal tienen test | medium | Gap pre-verificado; la ruta no se registra sin `web/dist` | defer (D2) |
| 67 | VG | La rama `IntegrityError` → 409 nunca se alcanza | medium | Gap pre-verificado; sólo ocurre con concurrencia | defer (D3) |
| 68 | VG | Email antes del commit en invitaciones | carried low | Igual que #25; `services/invitations.issue` sigue igual | carried rechazado |
| 69 | VG | `issue_magic_link` no valida `@` | false | Un email inválido no coincide con ninguna cuenta y recibe la respuesta genérica; sin daño | rechazado |
| 70 | BH | `state()`: una invitación revocada que pasa su fecha aparece como expired | medium | `services/invitations.py:state` evalúa la fecha antes que `active` | patch (P17) |
| 71 | BH | Tiempo de respuesta y 500 de SMTP revelan qué emails tienen cuenta | medium | `auth.py`: SMTP síncrono, sólo para cuentas conocidas; un fallo da 500. Viola "No revelar si un email tiene cuenta" | patch (P18) |
| 72 | BH | Email de enlace mágico antes del commit | low | `auth.py`: `deliver` antes de `db.commit()`; se resuelve con P18 | patch (P18) |
| 73 | BH | Sin límite de frecuencia en `/auth/magic-links` | medium | Endpoint público: inundación de correo a admins y gasto de cuota SMTP | patch (P19) |
| 74 | BH | Sin logout | carried low | Igual que #19 | carried rechazado |
| 75 | BH | No se puede desactivar un admin | medium | Nada revoca organizadores ni sesiones; el humano lo dejó fuera en el Checkpoint 1 | defer (D4) |
| 76 | BH | `Checkpoint.active` es estado muerto | low | Filtros coherentes y sin daño nombrado; quitarlo exige tocar la migración | rechazado |
| 77 | BH | STATUS.md afirma que se sirve `web/dist` | low | `STATUS.md:12`; la imagen aún no incluye la web y los enlaces `/invite` dan 404 | patch (P21) |
| 78 | BH | El catch-all SPA oculta los 404 de la API | low | No se registra sin `web/dist`; se trata en la spec de UI | rechazado |
| 79 | BH | No hay ningún test HTTP | medium | Los tests llaman a los handlers; enrutado, `Depends`, cookies y códigos de estado sin probar | patch (P26) |
| 80 | BH | Migración frente a modelos | carried medium | Igual que #3 | carried defer (D1) |
| 81 | BH | Se puede invitar a una carrera terminada | low | Caso raro; el arreglo añade una regla de negocio no pedida | rechazado |
| 82 | BH | Validación débil de emails y canal | low | El canal se valida a mano; un email de corredor inválido falla de forma ruidosa en SMTP | rechazado |
| 83 | BH | Los tests comparten una BD SQLite | low | Riesgo de orden entre tests; la suite pasa completa; el arreglo es más que directo | rechazado |
| 84 | BH | `sqlalchemy.url` engañoso en `alembic.ini` | low | `env.py` lo ignora; el arreglo es borrar la línea | patch (P22) |
| 85 | BH | Sin healthcheck | low | Railway funciona sin él; añade una ruta | rechazado |
| 86 | ECH | Fallo SMTP como oráculo de enumeración | medium | Igual que #71 | patch (P18) |
| 87 | ECH | Bootstrap concurrente del superadmin | low | Requiere dos primeros inicios de sesión simultáneos | rechazado |
| 88 | ECH | Cambiar `SUPERADMIN_EMAIL` a un admin existente no lo promueve | low | Sólo pasa al reconfigurar; decisión documentada por la implementación | rechazado |
| 89 | ECH | Consumo concurrente del enlace mágico | carried low | Igual que #41 | carried rechazado |
| 90 | ECH | Email de invitación antes del commit | carried low | Igual que #43 | carried rechazado |
| 91 | ECH | Reenvío concurrente da 500 | carried low | Igual que #46 | carried rechazado |
| 92 | ECH | El reenvío con menos de 1 h extiende la expiración | carried low | Igual que #47 | carried rechazado |
| 93 | ECH | Evento "opened" duplicado por concurrencia | low | Sólo duplica una fila de auditoría; caso raro | rechazado |
| 94 | ECH | SMTP sin timeout | medium | `smtplib.SMTP(host, port)` sin timeout: un worker colgado por petición | patch (P20) |
| 95 | ECH | `PUBLIC_APP_URL` sin definir da enlaces relativos | carried low | Igual que #39 | carried patch (ya aplicado como P5) |
| 96 | ECH | Error de coordenadas en el campo equivocado | low | `races.py:84,152` siempre devuelve `latitude`; arreglo directo | patch (P23) |
| 97 | ECH | `name`/`start_label` de la carrera sin recortar | low | `races.py:120,131` usan `model_dump()` crudo; arreglo directo | patch (P24) |
| 98 | ECH | Publicar una carrera ya terminada | low | Igual que #81 | rechazado |
| 99 | ECH | La expiración supera el fin de la carrera | low | Igual que #81 | rechazado |
| 100 | ECH | Afirmación: API con 404 frente a SPA | low | Igual que #78 | rechazado |
| 101 | ECH | Afirmación: el AC dice que nunca se devuelve el enlace, pero WhatsApp lo devuelve | false | El intent congelado exige copiar el enlace para WhatsApp; el arreglo sería editar la spec | rechazado |

## Design Notes

The checkpoint editor must not visually suggest an ordered route. A map pin list may be sorted for usability, but its display order cannot affect its data meaning or publication validation.

Use OpenStreetMap tiles through Leaflet so the project works without a proprietary map key. PostgreSQL is selected because future active races will generate concurrent writes. Railway runs **un solo servicio**: FastAPI sirve la API y el build estático de la web desde el mismo origen. Así la cookie `SameSite=Lax` viaja sin CORS ni CSRF cross-site, y las rutas `/invite/*` y `/auth/consume/*` caen en `index.html`. Las rutas de API no deben colisionar con rutas SPA: la API responde POST/JSON en `/auth/consume/{token}`, y el GET de esa ruta sirve la SPA.

## Verification

**Commands:**
- `uv run --project backend pytest backend/tests -q` -- expected: todos los tests pasan.
- `docker build -t alleycat .` -- expected: la imagen de la API se construye desde la raíz.
