# Estado de Alleycat Safety

Actualizado: 2026-10-28

## Entrega actual

Primera entrega, **administración de carreras e invitaciones (backend)**: implementada tras la iteración 1 de revisión; pendiente de commit y de la spec de UI.

- Roles: un superadmin (`SUPERADMIN_EMAIL`) crea admins; nadie se da de alta solo. Enlace mágico con respuesta genérica.
- Carreras en borrador, checkpoints sin orden (borrables en borrador), publicación, padrón de corredores.
- Invitaciones por email o enlace para WhatsApp: expiración, revocación, reenvío, estados `used`/`expired`/`revoked`/`opened`/`sent`.
- Un solo servicio Railway (`Dockerfile` raíz). La imagen aún no incluye `web/dist`: los enlaces `/invite/...` y `/auth/consume/...` no funcionarán en el navegador hasta que la spec de UI añada el build de la web.

## Verificación

- `uv run --project backend pytest backend/tests -q`: 24 passed.
- `docker build -t alleycat .`: OK. Humo HTTP en el contenedor contra SQLite y PostgreSQL 16.

## Pendiente

- Spec de UI (ver `deferred-work.md`).
- Configurar variables en Railway (ver `DEPLOYMENT.md`).
