- source_spec: none
  summary: Implement rider registration, participation activation, and active-session GPS location sharing.
  evidence: This is independently shippable after race and invitation data exist, and requires mobile permission, geofence, and location-freshness decisions.
- source_spec: none
  summary: Implement mechanical-help and emergency incident alerts for active riders.
  evidence: This is independently shippable after active participation and location capture exist, and requires notification and escalation decisions.
- source_spec: none
  summary: Implement QR checkpoint verification and the authorized live organizer map.
  evidence: These are independently shippable operational views after races, checkpoint records, and active participant locations exist.
- source_spec: `_bmad-output/implementation-artifacts/spec-race-administration-and-invitations.md`
  summary: UI web de la entrega 1 (editor de carreras y checkpoints con borrado en borrador, panel de invitaciones, sección superadmin de admins y vista del invitado), servida por la API desde el mismo origen, con los parches de UI del triage (P6, P7, P8, P11, P12, P16).
  evidence: Se separó de la spec de backend en el gate de tamaño del paso 2 (~3.700 tokens); la implementación previa está en la rama `review/slice1-snapshot` bajo `web/`.
- source_spec: `_bmad-output/implementation-artifacts/spec-race-administration-and-invitations.md`
  summary: (D1) Test automatizado que ejecute `alembic upgrade head` y ejercite el índice parcial `one_active_invitation`; hoy los tests usan `create_all`.
  evidence: Verificado a mano el 2026-10-28 contra SQLite y PostgreSQL 16 (`compare_metadata` sin diferencias, índice `WHERE active`).
- source_spec: `_bmad-output/implementation-artifacts/spec-race-administration-and-invitations.md`
  summary: Nota para la spec de UI: las rutas GET de la API (`/races`, `/riders`, `/admin/organizers`, `/auth/me`) ganan al fallback SPA; las rutas de la SPA no deben coincidir con ellas. La vista del invitado llama `POST /invite/{token}` y el login `POST /auth/consume/{token}`. El Dockerfile aún no construye `web/dist`. Las fechas de `RaceIn` deben llevar zona horaria.
  evidence: `backend/app/main.py` registra el catch-all al final; `RaceIn` usa `AwareDatetime`.
- source_spec: `_bmad-output/implementation-artifacts/spec-race-administration-and-invitations.md`
  summary: Test del fallback SPA de `backend/app/main.py`, incluida la guarda de path traversal y la prioridad de las rutas API.
  evidence: La ruta sólo se registra cuando existe `web/dist`; debe probarse con la spec de UI que añade la etapa de build web.
- source_spec: `_bmad-output/implementation-artifacts/spec-race-administration-and-invitations.md`
  summary: Test de la rama `IntegrityError` → 409 de `invite` (invitación duplicada concurrente).
  evidence: La pre-comprobación cubre el caso secuencial; la rama sólo se alcanza con concurrencia, así que hoy no la cubre ningún test.
- source_spec: `_bmad-output/implementation-artifacts/spec-race-administration-and-invitations.md`
  summary: Desactivar admins desde el superadmin, revocando sus sesiones, y logout.
  evidence: Hoy una cuenta admin no se puede retirar y una cookie robada vale 7 días; el humano lo dejó fuera de esta entrega en el Checkpoint 1.
- source_spec: `_bmad-output/implementation-artifacts/spec-web-ui-race-administration.md`
  summary: Test automatizado de que un clic en el mapa Leaflet cambia las coordenadas del checkpoint enviado.
  evidence: Simular eventos de Leaflet en jsdom es costoso; hoy sólo lo cubre la prueba manual en Chrome.
- source_spec: `_bmad-output/implementation-artifacts/spec-checkpoint-release.md`
  summary: La caducidad de la invitación (168 h por defecto; la UI no permite elegirla) no está ligada al horario de la carrera, así que invitar más de 7 días antes deja al corredor sin acceso cuando se liberan los checkpoints.
  evidence: `backend/app/routers/invitations.py:21` `expires_hours: int = 168`; `InvitationPanel.tsx` no envía `expires_hours`. Viene de la spec de backend; requiere decidir la regla (p. ej. caducar al terminar la carrera).
