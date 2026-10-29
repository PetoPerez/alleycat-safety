---
title: 'UI web de administración de carreras e invitaciones'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2ca04767814eb76f60578dd55880fa59a5e6b1db'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-race-administration-and-invitations.md'
  - '{project-root}/landing/design-system/alleycat-safety/MASTER.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** El backend de la entrega 1 ya está desplegable, pero no tiene interfaz. Los organizadores no pueden usarlo y los enlaces de invitación y de inicio de sesión que llegan por correo o WhatsApp no abren nada en el navegador.

**Approach:** Construir la Web/PWA responsive en español sobre la API existente y servirla desde el mismo origen que la API, en un solo servicio Railway. Incluye: inicio de sesión con enlace mágico; lista y editor de carreras con mapa Leaflet, checkpoints sin orden y borrado en borrador; publicación; padrón de corredores e invitaciones (email o copiar para WhatsApp, reenviar, revocar, estado); sección del superadmin para crear y listar admins; y la vista segura del invitado.

## Boundaries & Constraints

**Always:** Consumir sólo la API existente; el backend no cambia salvo el `Dockerfile`, que añade la etapa de build web. Mismo origen: el cliente usa rutas relativas y `credentials: "same-origin"`. Ninguna ruta de la SPA coincide con una GET de la API (`/races`, `/riders`, `/admin/organizers`, `/auth/me`). Toda acción async muestra su error legible: los 422 con `detail` en lista muestran el `msg` junto al campo de su `loc`. Las fechas se editan en hora local y se envían en ISO UTC con zona. El orden de los pins nunca sugiere ruta. La sección de admins sólo se ve con `role === "superadmin"`.

**Never:** No pedir permisos de GPS ni cámara, ni datos médicos o de emergencia. No mostrar el padrón ni los datos de la carrera al invitado más allá del resumen que da `POST /invite/{token}`. No añadir dependencias de UI (router, estado global, kits de componentes). No implementar registro de corredor, logout ni desactivación de admins.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Pedir enlace | Email en el formulario de acceso | Mensaje genérico; en desarrollo también el enlace de vista previa | Si falla la red, mostrar el error sin borrar el email |
| Abrir enlace mágico | GET `/auth/consume/{token}` en el navegador | La SPA hace `POST /auth/consume/{token}` y lleva a `/` con la sesión iniciada | Enlace inválido, usado o expirado: mensaje seguro y acceso para pedir otro |
| Editar carrera | Formulario de borrador con nombre vacío o fin ≤ inicio | No se guarda | Error bajo el campo indicado por `loc` |
| Cambiar de carrera | Organizador selecciona otra carrera | Editor, pins e invitaciones muestran sólo la nueva | — |
| Pin y borrado | Clic en el mapa + etiqueta; botón borrar en borrador | El pin aparece o desaparece; carrera publicada sin controles de edición | Error de la API visible |
| Publicar | Borrador con ≥1 checkpoint, tras confirmar | Estado `published`; habilita invitaciones | Sin checkpoints: botón deshabilitado con explicación |
| Invitar | Corredor del padrón + canal | La fila muestra nombre, estado y, si es WhatsApp, enlace copiable | El 409 ofrece reenviar o revocar |
| Vista de invitado | GET `/invite/{token}` | `POST /invite/{token}` muestra nombre, salida y horario | 404: estado seguro sin datos de la carrera |
| Superadmin | `role === "superadmin"` crea un admin | Aparece en la lista de admins | 409 o 422 visibles; un admin no ve la sección |

</frozen-after-approval>

## Code Map

- Rama `review/slice1-snapshot`, `web/`: UI previa revertida. Reutilizar con `git show review/slice1-snapshot:web/<ruta>`: `package.json` (React 18, react-leaflet 4, Vite 5, Vitest 2), `tsconfig.json`, `features/races/mapUtils.ts` y su test, y la estructura de `RaceEditor` e `InvitationPanel`. Corregir P6, P7, P8, P11, P12 y P16 del Triage Log de la spec de backend (fechas, errores, viewport, carga al cambiar de carrera, `router.tsx` muerto, `key` por carrera).
- `web/src/*.js` (ignorados por git): restos compilados; borrarlos.
- API: `backend/app/routers/{auth,admin,races,invitations}.py`. Los errores por campo vienen como `HTTPException(422, [{"loc": ["body", campo], "msg": ...}])`. `GET /auth/me` da `{id,email,role}`. `DELETE /races/{id}/checkpoints/{cid}` devuelve 204.
- `backend/app/main.py`: sirve `web/dist` desde `parents[2]/web/dist` con fallback a `index.html`. Con el árbol de la imagen (`/app/backend/app`) espera `/app/web/dist`.
- `Dockerfile`: añadir una etapa `node` que haga `npm ci && npm run build` en `web/` y copiar `dist` a `/app/web/dist`.
- `landing/design-system/alleycat-safety/MASTER.md`: tokens de color y tipografía (oscuro, naranja #EA580C, Inter).

## Tasks & Acceptance

**Execution:**
- [x] `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html` -- restaurar del snapshot; `vite.config.ts` con plugin react, entorno de test jsdom y proxy de desarrollo a `:8000`; `index.html` con doctype, `lang="es"`, viewport, title y manifest mínimo -- PWA responsive.
- [x] `web/src/api/client.ts` -- `request<T>` con rutas relativas y `same-origin`; tratar 204; un `ApiError` que lleve `fields` (de `loc`/`msg`) y un mensaje legible -- una sola frontera HTTP.
- [x] `web/src/main.tsx` -- enrutar por `location.pathname`: `/invite/*` es la vista de invitado, `/auth/consume/*` consume el enlace y `/` es la app; la app carga `/auth/me` y muestra acceso o panel -- sin router externo ni colisiones.
- [x] `web/src/features/races/RaceEditor.tsx` y `mapUtils.ts` -- crear y editar en borrador con errores por campo; conversión local↔UTC en `mapUtils` (o en un util al lado); pins con borrar; confirmar antes de publicar; montado con `key={race.id}` -- sin datos cruzados ni desfase horario.
- [x] `web/src/features/invitations/InvitationPanel.tsx` -- recargar al cambiar `raceId`; alta de corredor; invitar, reenviar y revocar; nombre del corredor sacado del padrón; botón copiar para WhatsApp -- uso diario sin clics de más.
- [x] `web/src/features/admin/AdminPanel.tsx` -- crear y listar admins, sólo para superadmin -- cumple la decisión de roles.
- [x] `web/src/style.css` -- tokens de MASTER.md, una columna móvil y foco visible -- coherente con la landing.
- [x] `web/src/**/*.test.ts(x)` -- cubrir la conversión de fechas, el parseo de `ApiError` y el enrutado por pathname, más una prueba con jsdom de cada fila de la matriz que dependa del cliente (mockeando `fetch`) -- protege la matriz.
- [x] `Dockerfile`, `DEPLOYMENT.md`, `STATUS.md` -- etapa de build web; documentar que los enlaces ya funcionan -- un solo servicio completo.

**Acceptance Criteria:**
- Given la imagen construida, when se abre `/`, `/invite/x` o `/auth/consume/x`, then responde la SPA; y `/auth/me` sin cookie sigue respondiendo 401 en JSON.
- Given una pantalla de 375 px de ancho, when se usa cualquier vista, then no hay scroll horizontal y los controles son operables.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Revisión del 2026-10-28, iteración 1. Capas: BH, ECH y VG. Diff `review-diff-webui.patch`, desde `2ca0476`.

| # | Capa | Hallazgo | Veredicto | Evidencia | Ruta |
|---|---|---|---|---|---|
| 1 | BH | Sin logout | false | Excluido explícitamente en **Never** del intent | rechazado |
| 2 | BH | Una sesión que expira no vuelve al login | medium | `App.tsx:72` sólo trata el 401 de `/auth/me` inicial; luego los 401 se muestran en línea | patch (P1) |
| 3 | BH | Sin guarda de "ocupado": doble envío | medium | Invitar, reenviar, revocar, corredor, checkpoint y admin no deshabilitan el botón; crea duplicados | patch (P2) |
| 4 | BH | Revocar sin confirmación | low | Acción irreversible al lado de "Reenviar"; un `confirm` | patch (P3) |
| 5 | BH | Pin en la salida si no se toca el mapa; sin entrada por teclado | medium | `RaceEditor.tsx:81`: `selected` arranca en la salida; colocar sólo con clic es una barrera de accesibilidad | patch (P4) |
| 6 | BH | El mapa no se recentra tras editar las coordenadas | low | `selected` se siembra una vez; corrección directa | patch (P5) |
| 7 | BH | Lat/lng en blanco se convierten en 0 | medium | `RaceEditor.tsx:36` usa `Number("")` = 0, coordenada válida | patch (P6) |
| 8 | BH | Un fallo de red se muestra como enlace inválido | medium | `App.tsx:36,55`: cualquier rechazo pone `setFailed(true)` | patch (P7) |
| 9 | BH | Error y éxito se ven igual en InvitationPanel | low | Un único `message` con `role=status` | patch (P8) |
| 10 | BH | Errores del backend en inglés | medium | El intent pide UI en español; los 401/409/422 conocidos se pueden mapear en el cliente sin tocar el backend | patch (P9) |
| 11 | BH | El enlace de WhatsApp desaparece al recargar sin aviso | low | Sólo existe en memoria; basta un texto de aviso | patch (P10) |
| 12 | BH | Copiar falla en silencio; "Copiado" nunca se reinicia | medium | `InvitationPanel.tsx:11`: el `catch` no muestra nada y se pega contenido viejo | patch (P11) |
| 13 | BH | `theme-color` distinto entre `index.html` y manifest | low | `#0F172A` frente a `#EA580C`; corrección directa | patch (P12) |
| 14 | BH | El manifest no tiene iconos | low | La instalación no es requisito de esta entrega; añade archivos | rechazado |
| 15 | BH | Falta `web/package-lock.json` en el diff | false | Existe en `web/`; el diff lo excluí yo al generarlo | rechazado |
| 16 | BH | Tiles de OSM con subdominio `{s}` obsoleto | low | Cambiar a `tile.openstreetmap.org`; corrección directa | patch (P13) |
| 17 | BH | Quitar StrictMode es frágil | low | Sólo afecta a desarrollo; el arreglo es más que directo | rechazado |
| 18 | BH | Flujos sin test (reenviar/revocar, corredor, crear carrera, 401) | medium | Igual que #20–22 | patch (P14) |
| 19 | BH | Roles en inglés; error tras crear admin | low | Las etiquetas en español son directas; el reintento se rechaza | patch (P9) |
| 20 | VG | Reenviar y revocar no se ejercitan | medium | Gap pre-verificado | patch (P14) |
| 21 | VG | Crear y guardar carrera sólo se prueban en el 422 | medium | Gap pre-verificado; no se comprueba el body UTC | patch (P14) |
| 22 | VG | Añadir corredor sin test | medium | Gap pre-verificado | patch (P14) |
| 23 | VG | El clic en el mapa no tiene test | medium | Gap pre-verificado; simular Leaflet en jsdom es costoso | defer (D1) |
| 24 | VG | Fallback SPA y traversal sin test | medium | Gap pre-verificado; ahora `web/dist` existe en la imagen | patch (P15) |
| 25 | VG | `decodeURIComponent` con escape malformado deja la página en blanco | medium | `App.tsx:14` lanza `URIError` en el render | patch (P16) |
| 26 | VG | Un 2xx no-JSON da un `SyntaxError` crudo | low | `client.ts:49`; corrección directa | patch (P17) |
| 27 | VG | El 422 de admin no tiene test | low | Fila "Superadmin" de la matriz | patch (P14) |
| 28 | ECH | URIError | medium | Igual que #25 | patch (P16) |
| 29 | ECH | 401 a mitad de sesión | medium | Igual que #2 | patch (P1) |
| 30 | ECH | Red o 5xx tratados como enlace inválido | medium | Igual que #8 | patch (P7) |
| 31 | ECH | Lat/lng vacías | medium | Igual que #7 | patch (P6) |
| 32 | ECH | Checkpoint doble | medium | Igual que #3 | patch (P2) |
| 33 | ECH | Corredor doble | medium | Igual que #3 | patch (P2) |
| 34 | ECH | Un 409 sin la invitación en la lista local no ofrece acciones | low | `conflict` queda undefined; refrescar y buscar es directo | patch (P18) |
| 35 | ECH | Portapapeles no disponible | medium | Igual que #12 | patch (P11) |
| 36 | ECH | 2xx no-JSON | low | Igual que #26 | patch (P17) |
| 37 | ECH | Coordenadas obsoletas tras el PUT | low | Igual que #6 | patch (P5) |

## Design Notes

Los íconos por defecto de Leaflet se rompen con Vite. Hay que importar `marker-icon.png`, `marker-icon-2x.png` y `marker-shadow.png` de `leaflet/dist/images` y asignarlos con `L.Icon.Default.mergeOptions`.

## Verification

**Commands:**
- `npm --prefix web ci && npm --prefix web run test` -- expected: todos los tests pasan.
- `npm --prefix web run build` -- expected: compila sin errores de TypeScript.
- `uv run --project backend pytest backend/tests -q` -- expected: los 24 tests siguen pasando.
- `docker build -t alleycat .` -- expected: la imagen incluye `/app/web/dist/index.html`.
