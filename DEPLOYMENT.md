# Deployment

One Railway service, built from the root `Dockerfile` (`railway.toml` points at it). FastAPI serves the API and, when `web/dist` exists in the image, the web app from the same origin, so the `SameSite=Lax` session cookie works without CORS. Non-API GETs (e.g. `/invite/<token>`, `/auth/consume/<token>`) fall back to `index.html`; the matching API calls are POSTs.

On start the container runs `alembic upgrade head`, then uvicorn on `$PORT`.

## Variables (set in Railway, never commit them)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Railway PostgreSQL URL. `postgres://` and `postgresql://` are rewritten to `postgresql+psycopg://`. |
| `APP_ENV` | Leave unset (or `production`) in deployed environments. Only an explicit `development` enables link previews in API responses and disables the `Secure` cookie flag. |
| `PUBLIC_APP_URL` | Public origin used to build magic-link and invitation URLs, e.g. `https://alleycat.up.railway.app`. |
| `SUPERADMIN_EMAIL` | The product owner's email. Only this email (or accounts the superadmin creates via `POST /admin/organizers`) can request a sign-in link. |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` (`true`) | Outgoing mail. Required outside development; without `SMTP_HOST` sign-in and email invitations fail loudly. |

## Local development

```bash
APP_ENV=development SUPERADMIN_EMAIL=you@example.com uv run --project backend uvicorn app.main:app --app-dir backend --reload
uv run --project backend pytest backend/tests -q
```

With `APP_ENV=development` no email is sent; the sign-in and invitation links come back in the API response.
