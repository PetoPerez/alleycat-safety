---
title: 'Caducidad de invitaciones al terminar la carrera'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '09a46146c4064ce35ad163df2f6fed2cc5e0eb23'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Las invitaciones caducan 168 h después de emitirse, sin relación con la carrera. Si se invita con más de 7 días de antelación, el corredor pierde el acceso antes de que se liberen los checkpoints. Además, el reenvío recalcula la expiración en horas truncadas. Esto resuelve la entrada correspondiente de `deferred-work.md`.

**Approach:** Toda invitación caduca exactamente en `race.ends_at`.

**Decisions (humano, 2026-10-29):**
- La invitación caduca al **terminar** la carrera, no al iniciarla.
- Funciona hasta la hora de fin, aunque se abra por primera vez con la carrera en curso.

## Boundaries & Constraints

**Always:** `expires_at = race.ends_at` al invitar y al reenviar. La regla de una sola invitación activa, la revocación, los estados y el 404 seguro no cambian.

**Never:** No dejar que el organizador elija la duración. No invitar ni reenviar en una carrera ya terminada. No tocar invitaciones revocadas o reemplazadas.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Invitar con antelación | Carrera publicada que termina dentro de 20 días | `expires_at == ends_at`; el enlace funciona tras la liberación y durante la carrera | — |
| Abrir durante la carrera | starts_at ≤ ahora < ends_at, invitación activa | Resumen y checkpoints liberados | — |
| Después del fin | ahora ≥ ends_at | Estado `expired`; el enlace da el 404 seguro | — |
| Invitar o reenviar en carrera terminada | ahora ≥ ends_at | No se crea nada | 422 «La carrera ya terminó» |
| Reenviar | Invitación activa | El reemplazo tiene `expires_at == ends_at` | — |
| Invitaciones existentes | Filas `active` en producción | La migración fija su `expires_at` en el `ends_at` de su carrera | Las inactivas no cambian |

</frozen-after-approval>

## Code Map

- `backend/app/services/invitations.py` `issue()`: hoy recibe `expires_hours`. Pasa a usar `race.ends_at`.
- `backend/app/routers/invitations.py`: quitar `InviteIn.expires_hours` y su validación de rango (los campos extra se ignoran). Quitar `hours_left` de `resend`. Añadir la guarda de carrera terminada en `invite` y `resend`, reutilizando `utcnow` y el estilo `HTTPException(422, ...)`.
- `backend/alembic/versions/0003_invitation_expiry_race_end.py`: `UPDATE invitations SET expires_at = (SELECT ends_at FROM races WHERE races.id = invitations.race_id) WHERE active`. El downgrade no hace nada (documentarlo).
- `backend/tests/test_lifecycle.py`: hoy pasa `expires_hours=5` y `=0` (líneas ~317 y ~326); adaptar esos tests.
- `web/src/api/client.ts`: mensaje en español para el nuevo 422. `InvitationPanel.tsx` ya muestra «vence …» con `expires_at`: no cambia.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/services/invitations.py`, `backend/app/routers/invitations.py` -- caducidad en `ends_at` y guarda de carrera terminada -- la regla nueva.
- [x] `backend/alembic/versions/0003_invitation_expiry_race_end.py` -- migración de datos de las invitaciones activas -- corrige las ya emitidas.
- [x] `backend/tests/test_lifecycle.py` -- una prueba por fila de la matriz, controlando el reloj con el fixture `clock`, más la migración 0003 sobre una base con una invitación activa y otra revocada -- protege la regla.
- [x] `web/src/api/client.ts`, `web/src/matrix.test.tsx` -- mensaje en español del 422 y un test que lo muestre -- UI coherente.

**Acceptance Criteria:**
- Given una invitación emitida 20 días antes de la carrera, when se liberan los checkpoints y durante toda la carrera, then el invitado los ve.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Revisión del 2026-10-29, iteración 1. Capas: BH, ECH y VG. Diff `review-diff-expiry.patch`, desde `09a4614`.

| # | Capa | Hallazgo | Veredicto | Evidencia | Ruta |
|---|---|---|---|---|---|
| 1 | ECH/BH | La migración reactiva invitaciones activas ya caducadas por la regla de 168 h | false | El intent congelado alinea las "filas `active`" y la matriz dice "Las inactivas no cambian"; esas filas son justo las víctimas del defecto que se corrige (caducaron por la regla vieja sin que nadie las revocara) | rechazado |
| 2 | ECH | Una fila activa con `used_at` cambiaría su caducidad | false | Ningún código asigna `used_at` (el registro está diferido) | rechazado |
| 3 | ECH/BH | La guarda de carrera terminada vive en el router, no en `issue()` | low | Sólo hay dos llamadas y ambas tienen la guarda; moverla exige un error de dominio | rechazado |
| 4 | ECH/BH | El test web cubre sólo la ruta de reenvío | low | `matrix.test.tsx`: la ruta de invitar comparte el mapa de mensajes pero no tiene test; añadirlo es directo | patch (P1) |
| 5 | ECH | Afirmación: "los estados no cambian" | false | Igual que #1 | rechazado |
| 6 | BH | El test de migración no incluye una fila activa ya caducada | low | Hay que fijar en un test el comportamiento elegido en #1 | patch (P2) |
| 7 | BH | Los tokens ya no tienen vida máxima | false | Decisión explícita del humano: caducan al terminar la carrera | rechazado |
| 8 | BH | `expires_hours` se descarta en silencio | low | Pydantic ignora los extras por defecto; sin daño actual | rechazado |
| 9 | BH | El panel ofrece acciones tras el fin de la carrera | low | El 422 se muestra en español; rara vez se invita tras la carrera | rechazado |
| 10 | BH | Sin test de reenvío justo antes del fin | low | Los límites `<=`/`>` ya están cubiertos en el instante exacto | rechazado |
| 11 | BH | Nombres heredados en el test; entrada diferida sin cerrar | low | Cosmético; BMAD prohíbe modificar las entradas existentes de deferred-work | rechazado |
| 12 | VG | Sin huecos de verificación | — | Cada cambio de comportamiento tiene un test que fallaría | — |
| 13 | VG | La fila activa caducada no está fijada por ningún test | low | Igual que #6 | patch (P2) |

## Verification

**Commands:**
- `uv run --project backend pytest backend/tests -q` -- expected: todo pasa.
- `npm --prefix web run test && npm --prefix web run build` -- expected: todo pasa y compila.
