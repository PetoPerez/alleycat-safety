---
title: 'Liberación de checkpoints a participantes'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '172305eb7baaab9bdd7811c40827d0ac78d31250'
context:
  - '{project-root}/_bmad-output/specs/spec-alleycat-safety/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** El invitado sólo ve el nombre, la salida y el horario de la carrera. CAP-1 pide que los participantes vean los checkpoints, pero en un alleycat no deben conocerse antes de tiempo, porque eso daría ventaja para planear la ruta.

**Approach:** Los checkpoints de una carrera publicada permanecen ocultos para los invitados hasta su liberación. Después, quien tenga una invitación válida los ve en un mapa y en una lista con latitud y longitud, sin orden.

**Decisions (humano, 2026-10-28):**
- **Liberación programada:** cada carrera tiene "minutos antes del inicio" (10 por defecto) y los checkpoints se liberan solos a esa hora.
- **Liberar ahora:** el admin dispone de un botón para adelantar la liberación de una carrera publicada.
- **Irreversible:** una vez liberados, no se pueden volver a ocultar.
- La colocación de checkpoints (por latitud/longitud o clic en el mapa) ya existe y no cambia.

## Boundaries & Constraints

**Always:** El servidor decide la visibilidad comparando `utcnow()` con el momento efectivo de liberación: `released_at` si existe, si no `starts_at − minutos`. El cliente nunca recibe checkpoints antes de ese momento. Sólo una invitación válida, la misma regla que hoy usa `POST /invite/{token}`, da acceso. Se mantiene el orden alfabético de los pins sin numeración.

**Never:** No exponer checkpoints en ninguna respuesta pública antes de la liberación, tampoco su número. No permitir ocultarlos de nuevo. No pedir GPS ni registro del corredor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Configurar minutos | Borrador con minutos entre 0 y 1440 | Se guarda; por defecto 10 | Fuera de rango: 422 en el campo `checkpoints_release_minutes` |
| Invitado antes de la liberación | Invitación válida; ahora < momento de liberación | Resumen de la carrera más `checkpoints_release_at`, sin checkpoints; la vista muestra la hora local y se refresca sola | — |
| Liberación programada | Ahora ≥ inicio − minutos | La respuesta incluye todos los checkpoints (nombre, lat, lng) | — |
| Liberar ahora | El admin dueño de una carrera publicada confirma | Se fija `released_at = ahora`; los invitados los ven de inmediato | Borrador: 422; otra persona: 404; ya liberada: 200 idempotente sin mover `released_at` |
| Invitación inválida | Token expirado, revocado o desconocido | 404 seguro, como hoy | Nunca checkpoints ni hora de liberación |

</frozen-after-approval>

## Code Map

- `backend/app/models.py`: `Race` recibe `checkpoints_release_minutes: int` (default 10) y `checkpoints_released_at: UTCDateTime | None`. Reutilizar `UTCDateTime` y `utcnow` de `database.py`.
- `backend/alembic/versions/0002_checkpoint_release.py`: nueva migración que añade ambas columnas (server_default 10 para las filas existentes).
- `backend/app/routers/races.py`: `RaceIn` y `RaceOut` incluyen los minutos, con validación por campo reutilizando `field_error`. Nuevo `POST /races/{id}/release-checkpoints` con `race_for`. `RaceOut` expone `checkpoints_release_at` y `checkpoints_released`.
- `backend/app/services/races.py`: un helper puro `release_at(race)` y otro `released(race, now)`.
- `backend/app/routers/invitations.py` `open_invite`: añadir `checkpoints_release_at` y, si está liberada, `checkpoints: [{name, latitude, longitude}]` ordenados por nombre.
- `web/src/features/races/RaceEditor.tsx`: campo de minutos en `RaceForm`. En carrera publicada, mostrar el estado («Se liberan a las HH:MM» o «Liberados») y el botón «Liberar ahora» con `confirm` y `useBusy`.
- `web/src/App.tsx` `InviteView`: antes de la liberación, la hora local y un refresco cada 30 s con `useTokenPost`/retry. Después, un mapa Leaflet de sólo lectura y una lista con lat/lng. Reutilizar el fix de iconos y `pinsForDisplay`.
- `web/src/api/client.ts`: tipos y mensajes en español de los errores nuevos.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/models.py`, `backend/alembic/versions/0002_checkpoint_release.py` -- columnas nuevas y migración -- persistencia de la regla.
- [x] `backend/app/services/races.py`, `backend/app/routers/races.py` -- validación de minutos, endpoint de liberar ahora (idempotente) y campos en `RaceOut` -- control del admin.
- [x] `backend/app/routers/invitations.py` -- `open_invite` filtra por liberación -- la frontera de visibilidad vive en el servidor.
- [x] `backend/tests/test_lifecycle.py` -- una prueba por fila de la matriz, controlando el reloj con monkeypatch de `utcnow`; además, que la migración 0002 aplica -- protege la regla.
- [x] `web/src/features/races/RaceEditor.tsx`, `web/src/api/client.ts` -- campo de minutos, estado y botón -- UI del admin.
- [x] `web/src/App.tsx` -- vista del invitado antes y después de la liberación, con refresco -- UI del participante.
- [x] `web/src/matrix.test.tsx` -- invitado antes (hora mostrada, sin pins), invitado después (pins y lat/lng), liberar ahora (confirm, POST y estado) y minutos inválidos (error en el campo) -- protege la UI.

**Acceptance Criteria:**
- Given un invitado con la vista abierta antes de la liberación, when llega la hora programada, then en 30 s como máximo ve los checkpoints sin recargar la página.
- Given una carrera ya liberada, when el admin la consulta, then no existe ninguna acción para ocultar los checkpoints.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Revisión del 2026-10-28, iteración 1. Capas: BH, ECH y VG. Diff `review-diff-release.patch`, desde `172305e`.

| # | Capa | Hallazgo | Veredicto | Evidencia | Ruta |
|---|---|---|---|---|---|
| 1 | BH | La invitación caduca antes de la liberación | high | La UI no envía `expires_hours`, así que se usan 168 h; invitar más de 7 días antes deja al corredor sin checkpoints. El defecto viene de la spec de backend | defer (D1) |
| 2 | BH | El sondeo ignora la hora de liberación | low | Eficiencia: un POST cada 30 s; el arreglo es más que directo | rechazado |
| 3 | BH | El estado del admin queda obsoleto tras la hora programada | medium | `RaceEditor.tsx:429` se calcula una vez por render | patch (P1) |
| 4 | BH | El mapa del invitado depende de los efectos de `RaceEditor` (CSS e iconos) | low | Si se quita o se carga en diferido ese import, se rompe el mapa del invitado; extraerlo a un módulo compartido es directo | patch (P2) |
| 5 | BH | `checkpoints: []` rompe el mapa | false | Publicar exige ≥1 checkpoint y borrar sólo se permite en borrador; una carrera liberada siempre tiene pins | rechazado |
| 6 | BH | Orden distinto en servidor y cliente | low | El cliente reordena con `localeCompare`; sin daño visible | rechazado |
| 7 | BH | 1440 repetido como literal | low | Sin daño concreto mientras no cambie el límite | rechazado |
| 8 | BH | Minutos fraccionarios dan un error en inglés | low | `noValidate` + `Number(...)`; validar `Number.isInteger` es directo | patch (P3) |
| 9 | BH | `RaceOut` no expone `released_at` | low | El admin no lo necesita para operar | rechazado |
| 10 | BH | El modelo importa un servicio y lee el reloj | low | Molestia de desarrollo; sin fallo | rechazado |
| 11 | BH | Faltan tests: editar minutos, minutos=0, downgrade | medium | Editar minutos coincide con #14; minutos=0 es barato; el downgrade se rechaza | patch (P4) |
| 12 | VG | `isReleased` en el editor sin test | medium | Gap pre-verificado | patch (P1) |
| 13 | VG | Fallo o 404 de un sondeo tras un ok sin test | medium | Gap pre-verificado | patch (P4) |
| 14 | VG | Editar puede resetear los minutos | medium | Gap pre-verificado; los fixtures siempre usan 10 | patch (P4) |
| 15 | ECH | Respuestas de sondeo fuera de orden | low | Requiere una petición colgada más de 30 s; añadir una guarda es más que directo | rechazado |
| 16 | ECH | Un fallo de sondeo no avisa de que los datos están obsoletos | low | Cubierto por #22 | rechazado |
| 17 | ECH | Minutos fraccionarios | low | Igual que #8 | patch (P3) |
| 18 | ECH | `1e400` se convierte en Infinity y luego en null | low | El mismo arreglo con `Number.isFinite` | patch (P3) |
| 19 | ECH | "Liberar ahora" concurrente | low | Sólo mueve `released_at` milisegundos | rechazado |
| 20 | ECH | `checkpoints: []` | false | Igual que #5 | rechazado |
| 21 | ECH | Admin obsoleto | medium | Igual que #3 | patch (P1) |
| 22 | ECH | Afirmación "30 s como máximo" falla tras un error | low | Un sondeo fallido espera 30 s más; reintentar antes es directo | patch (P5) |

## Verification

**Commands:**
- `uv run --project backend pytest backend/tests -q` -- expected: todo pasa.
- `npm --prefix web run test && npm --prefix web run build` -- expected: todo pasa y compila.
- `docker build -t alleycat .` -- expected: la imagen se construye.
