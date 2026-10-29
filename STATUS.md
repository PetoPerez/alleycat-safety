# Estado de Alleycat Safety

Actualizado: 2026-10-28

## Entrega actual

Primera entrega, **administración de carreras e invitaciones**: backend (commit `ac1cfae`) y UI web (spec `spec-web-ui-race-administration.md`), pendiente de revisión y commit.

- Roles: un superadmin (`SUPERADMIN_EMAIL`) crea admins; nadie se da de alta solo. Enlace mágico con respuesta genérica.
- Carreras en borrador, checkpoints sin orden (borrables en borrador), publicación, padrón de corredores.
- Invitaciones por email o enlace para WhatsApp: expiración, revocación, reenvío, estados `used`/`expired`/`revoked`/`opened`/`sent`.
- UI web en español (`web/`): acceso por enlace mágico, carreras con mapa y checkpoints sin orden, publicación, padrón e invitaciones (email o copiar para WhatsApp, reenviar, revocar), sección de admins para el superadmin y vista del invitado.
- Un solo servicio Railway (`Dockerfile` raíz con etapa de build web). Los enlaces `/invite/...` y `/auth/consume/...` ya abren la web en el navegador.

## Verificación

- `uv run --project backend pytest backend/tests -q`: 24 passed + `test_spa.py` (fallback SPA).
- `npm --prefix web run test`: 34 passed. `npm --prefix web run build`: OK.
- `docker build -t alleycat .`: OK, la imagen incluye `/app/web/dist/index.html`. `/`, `/invite/x` y `/auth/consume/x` sirven la SPA; `/auth/me` sin cookie da 401 JSON. Flujo completo probado en Chrome a 375 px sin scroll horizontal.

## Pendiente

- Revisión y commit de la UI web.
- Configurar variables en Railway (ver `DEPLOYMENT.md`).
