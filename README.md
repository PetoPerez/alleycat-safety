# Alleycat Safety

PWA para organizar y acompañar carreras **alleycat**: carreras urbanas de bicicleta sin ruta obligatoria, donde cada corredor decide en qué orden visita los checkpoints.

| | |
|---|---|
| 🌐 **Sitio** | https://alleycat-safety.alejandroperezlaureano.workers.dev |
| 🚲 **Plataforma** | https://web-production-0557a.up.railway.app |
| ▶️ **Video** | https://www.youtube.com/watch?v=oI4lp0mR6Uo |

## Qué es

En una alleycat no hay un recorrido marcado. La organización igual necesita saber quién participa, dónde están los puntos de control y cómo reaccionar si alguien tiene un problema. Alleycat Safety da a los organizadores una herramienta para preparar la carrera e invitar sólo a corredores conocidos. A los corredores les da un enlace privado para ver la carrera y, en el momento indicado, sus checkpoints.

El repositorio contiene:

- **`landing/`**: el sitio explicativo, una página estática publicada en Cloudflare.
- **`backend/`**: la API en FastAPI, con PostgreSQL, SQLAlchemy y migraciones Alembic.
- **`web/`**: la plataforma, una PWA en React, TypeScript y Vite con mapas Leaflet/OpenStreetMap, servida por la propia API desde el mismo dominio.
- **`_bmad-output/`**: las especificaciones, los registros de revisión y el trabajo diferido. El desarrollo se coordina con el método BMAD.

## Cómo funciona

### Roles

- **Superadmin**: la cuenta definida por `SUPERADMIN_EMAIL`. Es la única que puede crear admins.
- **Admin u organizador**: crea carreras, mantiene su padrón de corredores y envía invitaciones.
- **Corredor invitado**: no tiene cuenta. Accede a una sola carrera mediante su enlace de invitación.

No hay registro abierto ni padrón público. Un email que no pertenece a una cuenta nunca recibe un enlace de acceso, y la respuesta es la misma tanto si la cuenta existe como si no.

### Flujo de una carrera

1. **Acceso sin contraseña.** El organizador escribe su email y recibe un **enlace mágico**: dura 15 minutos y sólo sirve una vez. Al abrirlo inicia una sesión de 7 días, guardada en una cookie segura.
2. **Crear la carrera.** Se define el nombre, el punto de salida y el horario. La carrera queda como borrador privado.
3. **Colocar checkpoints.** Se agregan en el mapa con un clic o escribiendo latitud y longitud, y mientras la carrera está en borrador se pueden borrar. Los checkpoints **no tienen orden**: la lista es alfabética y nunca sugiere una ruta.
4. **Publicar.** Hace falta al menos un checkpoint, y se pide confirmación. Una carrera publicada ya no se puede editar.
5. **Invitar.** Desde el padrón (nombre más email y/o teléfono) se invita a cada corredor:
   - **por correo**, enviado por SMTP;
   - **por WhatsApp**, con un enlace para copiar y compartir.

   Cada invitación es individual, caduca, se puede revocar o reenviar (lo que cambia el enlace) y muestra su estado: enviada, abierta, expirada o revocada. Un corredor no puede tener dos invitaciones activas para la misma carrera.
6. **Vista del invitado.** Con un enlace válido, el corredor ve el nombre, la salida y el horario de la carrera. Un enlace inválido, expirado o revocado no revela ningún dato.
7. **Liberación de checkpoints.** Los checkpoints permanecen **ocultos** hasta un momento que define el organizador (por defecto, 10 minutos antes del inicio). Hasta entonces el invitado ve la hora de liberación y la página se actualiza sola. A esa hora aparecen el mapa y la lista con latitud y longitud. El organizador puede adelantar la liberación con **«Liberar ahora»**, y una vez liberados no se pueden volver a ocultar. Es el servidor quien decide: ningún dato de los checkpoints sale antes de tiempo.

### Privacidad y seguridad

- Los tokens de los enlaces y de la sesión se guardan como hash, nunca en texto plano.
- La web y la API comparten dominio, así que la cookie de sesión es `HttpOnly`, `Secure` y `SameSite=Lax`, sin necesidad de CORS.
- Fuera de `APP_ENV=development`, la API nunca devuelve enlaces de acceso en sus respuestas: sólo llegan por correo.
- El envío de enlaces de acceso está limitado a uno por minuto por cuenta.

## Arquitectura

```
Navegador ──▶ Railway (un solo servicio Docker)
               ├─ FastAPI  /auth, /admin, /races, /riders, /invitations, /invite
               ├─ web/dist (la PWA); el resto de rutas GET devuelven index.html
               └─ PostgreSQL (alembic upgrade head en cada arranque)
```

## Desarrollo local

Requisitos: [uv](https://docs.astral.sh/uv/), Node 22 o superior y Docker (opcional).

```bash
# API en :8000 con SQLite; los enlaces aparecen en la respuesta en lugar de enviarse por correo
cd backend && APP_ENV=development SUPERADMIN_EMAIL=tu@email.com uv run uvicorn app.main:app --reload

# Web en :5173, que pasa las llamadas a la API de :8000
npm --prefix web install && npm --prefix web run dev
```

### Pruebas

```bash
uv run --project backend pytest backend/tests -q   # backend
npm --prefix web run test                          # web (Vitest + jsdom)
npm --prefix web run build                         # comprobación de tipos y build
docker build -t alleycat .                         # imagen de producción
```

## Despliegue

Railway construye el `Dockerfile` de la raíz con cada push a `main`. Variables necesarias: `DATABASE_URL`, `APP_ENV=production`, `PUBLIC_APP_URL`, `SUPERADMIN_EMAIL` y `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. El detalle está en [DEPLOYMENT.md](DEPLOYMENT.md).

El sitio de `landing/` se publica en Cloudflare con `npx wrangler deploy`.

## Próximamente

- Registro del corredor y activación de su participación.
- Ubicación compartida con consentimiento y mapa en vivo para la organización.
- Alertas de asistencia mecánica y de emergencia.
- Verificación de checkpoints con QR, sin orden.

> Alleycat Safety es una herramienta de coordinación y **no reemplaza a los servicios de emergencia**.
