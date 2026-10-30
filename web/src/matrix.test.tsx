// One jsdom test per I/O-matrix row of spec-web-ui-race-administration.md, with fetch mocked.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {App} from "./App";
import {standings} from "./features/races/Board";
import {act} from "react";
import {formatRelease} from "./features/races/mapUtils";
import {button, cleanup, click, field, flush, mockApi, render, submit, text, type} from "./test/dom";

const race = (id: number, name: string, status = "draft") => ({
  id, name, status, start_label: `Salida ${name}`, latitude: 19.43, longitude: -99.13,
  starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z",
  checkpoints_release_minutes: 10, checkpoints_release_at: "2099-11-01T17:50:00Z", checkpoints_released: false,
});
const admin = {id: 1, email: "org@x.mx", role: "admin"};
const at = (path: string) => history.replaceState(null, "", path);

beforeEach(() => at("/"));
afterEach(async () => { await cleanup(); vi.useRealTimers(); });

describe("matrix", () => {
  it("Pedir enlace: generic message plus dev preview; network failure keeps the email", async () => {
    let fail = false;
    const api = mockApi({
      "GET /auth/me": {status: 401, body: {detail: "Organizer authentication required"}},
      "POST /auth/magic-links": () => (fail ? {status: 500} : {body: {detail: "generic", link: "http://x/auth/consume/t1"}}),
    });
    await render(<App />);
    await type(field("Email"), "org@x.mx");
    await submit(document.querySelector("form")!);
    expect(api.calls.at(-1)).toEqual({key: "POST /auth/magic-links", body: {email: "org@x.mx"}});
    expect(text()).toContain("te enviamos un enlace");
    expect(text()).toContain("http://x/auth/consume/t1");

    fail = true;
    api.fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await submit(document.querySelector("form")!);
    expect(text()).toContain("No se pudo conectar");
    expect(field("Email").value).toBe("org@x.mx");
  });

  it("Abrir enlace mágico: POSTs the token, lands on / signed in", async () => {
    at("/auth/consume/tok");
    const api = mockApi({"POST /auth/consume/tok": {body: {status: "signed_in"}}, "GET /auth/me": {body: admin}, "GET /races": {body: []}});
    await render(<App />);
    expect(api.calls[0].key).toBe("POST /auth/consume/tok");
    expect(location.pathname).toBe("/");
    expect(text()).toContain("Mis carreras");
  });

  it("Abrir enlace mágico inválido: safe message and a way to ask again", async () => {
    at("/auth/consume/bad");
    mockApi({"POST /auth/consume/bad": {status: 404, body: {detail: "Magic link is invalid"}}});
    await render(<App />);
    expect(text()).toContain("no es válido");
    expect(document.querySelector<HTMLAnchorElement>("a.btn-primary")!.getAttribute("href")).toBe("/");
  });

  it("Editar carrera: 422 errors land under the field named by loc", async () => {
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno")]}, "GET /races/1/checkpoints": {body: []},
      "GET /races/1/riders": {body: []}, "GET /races/1/invitations": {body: []},
      "PUT /races/1": {status: 422, body: {detail: [{loc: ["body", "ends_at"], msg: "End time must be after start time"}]}},
    });
    await render(<App />);
    await click(button("Uno"));
    const form = field("Fin (hora local)").closest("form")!;
    await submit(form);
    const ends = field("Fin (hora local)");
    expect(ends.getAttribute("aria-invalid")).toBe("true");
    expect(ends.parentElement!.textContent).toContain("El fin debe ser posterior al inicio.");
    expect(field("Nombre").parentElement!.querySelector(".field-error")).toBeNull();
  });

  it("Cambiar de carrera: editor, pins and invitations show only the new race", async () => {
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno"), race(2, "Dos", "published")]},
      "GET /races/1/checkpoints": {body: [{id: 11, name: "Pin de Uno", latitude: 19.4, longitude: -99.1}]},
      "GET /races/2/checkpoints": {body: [{id: 21, name: "Pin de Dos", latitude: 19.4, longitude: -99.1}]},
      "GET /races/1/riders": {body: []}, "GET /races/2/riders": {body: [{id: 5, name: "Ana", email: "a@x"}]},
      "GET /races/1/invitations": {body: []},
      "GET /races/2/invitations": {body: [{id: 7, rider_id: 5, channel: "email", expires_at: "2026-11-05T00:00:00Z", delivery_status: "sent", state: "sent"}]},
    });
    await render(<App />);
    await click(button("Uno"));
    expect(text()).toContain("Pin de Uno");
    expect(text()).toContain("Aún no hay invitaciones");
    await click(button("Dos"));
    expect(text()).toContain("Pin de Dos");
    expect(text()).not.toContain("Pin de Uno");
    expect(text()).toContain("Ana");
    expect(text()).toContain("Salida Dos");
  });

  it("Pin y borrado: add and delete in draft; published has no edit controls", async () => {
    let pins: object[] = [];
    const api = mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno"), race(2, "Dos", "published")]},
      "GET /races/1/checkpoints": () => ({body: pins}),
      "GET /races/2/checkpoints": {body: [{id: 21, name: "Fijo", latitude: 19.4, longitude: -99.1}]},
      "POST /races/1/checkpoints": () => { pins = [{id: 12, name: "Puente", latitude: 19.43, longitude: -99.13}]; return {body: pins[0]}; },
      "DELETE /races/1/checkpoints/12": () => { pins = []; return {status: 204}; },
      "GET /races/1/riders": {body: []}, "GET /races/2/riders": {body: []}, "GET /races/1/invitations": {body: []}, "GET /races/2/invitations": {body: []},
    });
    await render(<App />);
    await click(button("Uno"));
    expect(button("Añadir checkpoint").disabled).toBe(true); // no point chosen yet: never defaults to the start
    await type(field("Latitud del checkpoint"), "19.43");
    await type(field("Longitud del checkpoint"), "-99.13");
    await type(field("Etiqueta del checkpoint"), "Puente");
    await submit(field("Etiqueta del checkpoint").closest("form")!);
    expect(api.calls.find(c => c.key === "POST /races/1/checkpoints")!.body).toEqual({name: "Puente", latitude: 19.43, longitude: -99.13, finish: false});
    expect(text()).toContain("Puente");
    await click(button("Borrar"));
    expect(text()).not.toContain("Puente (");
    expect(text()).toContain("Aún no hay checkpoints");

    await click(button("Dos"));
    expect(text()).toContain("Fijo");
    expect(document.querySelector('button[aria-label^="Borrar"]')).toBeNull();
    expect(() => field("Etiqueta del checkpoint")).toThrow();
    expect(text()).not.toContain("Publicar carrera");
  });

  it("Pin: API error is visible", async () => {
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno")]}, "GET /races/1/checkpoints": {body: []},
      "GET /races/1/riders": {body: []}, "GET /races/1/invitations": {body: []},
      "POST /races/1/checkpoints": {status: 422, body: {detail: [{loc: ["body", "latitude"], msg: "Invalid coordinates"}]}},
    });
    await render(<App />);
    await click(button("Uno"));
    await type(field("Latitud del checkpoint"), "1");
    await type(field("Longitud del checkpoint"), "1");
    await type(field("Etiqueta del checkpoint"), "X");
    await submit(field("Etiqueta del checkpoint").closest("form")!);
    expect(text()).toContain("Coordenadas no válidas.");
  });

  it("Publicar: disabled with explanation without pins; publishes after confirming", async () => {
    let pins: object[] = [];
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno")]},
      "GET /races/1/checkpoints": () => ({body: pins}),
      "GET /races/1/riders": {body: []}, "GET /races/1/invitations": {body: []},
      "POST /races/1/publish": {body: race(1, "Uno", "published")},
    });
    await render(<App />);
    await click(button("Uno"));
    expect(button("Publicar carrera").disabled).toBe(true);
    expect(text()).toContain("Añade al menos un checkpoint para poder publicar");
    expect(text()).toContain("Publica la carrera para poder invitar");
    await cleanup();

    pins = [{id: 1, name: "A", latitude: 1, longitude: 1}];
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno")]},
      "GET /races/1/checkpoints": () => ({body: pins}),
      "GET /races/1/riders": {body: []}, "GET /races/1/invitations": {body: []},
      "POST /races/1/publish": {body: race(1, "Uno", "published")},
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await render(<App />);
    await click(button("Uno"));
    await click(button("Publicar carrera"));
    expect(confirm).toHaveBeenCalled();
    expect(text()).toContain("Publicada");
    expect(text()).not.toContain("Publicar carrera");
    expect(button("Invitar")).toBeTruthy();
  });

  it("Invitar: row shows name, state and copyable WhatsApp link; 409 offers resend or revoke", async () => {
    let invites: object[] = [];
    let conflict = false;
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno", "published")]},
      "GET /races/1/checkpoints": {body: []},
      "GET /races/1/riders": {body: [{id: 5, name: "Ana", phone: "555"}]},
      "GET /races/1/invitations": () => ({body: invites}),
      "POST /races/1/invitations": () => {
        if (conflict) return {status: 409, body: {detail: "Active invitation exists; resend or revoke it"}};
        invites = [{id: 9, rider_id: 5, channel: "whatsapp", expires_at: "2026-11-05T00:00:00Z", delivery_status: "link_ready", state: "sent"}];
        return {body: {id: 9, delivery_status: "link_ready", state: "sent", expires_at: "2026-11-05T00:00:00Z", link: "https://app/invite/secret"}};
      },
    });
    await render(<App />);
    await click(button("Uno"));
    await type(field("Corredor"), "5");
    await submit(button("Invitar").closest("form")!);
    const row = document.querySelector(".list li.stack")!;
    expect(row.textContent).toContain("Ana");
    expect(row.textContent).toContain("Enviada");
    expect(row.querySelector<HTMLInputElement>("input[readonly]")!.value).toBe("https://app/invite/secret");
    expect(row.textContent).toContain("Copiar para WhatsApp");
    expect(row.textContent).toContain("Cópialo ahora");

    conflict = true;
    await submit(button("Invitar").closest("form")!);
    expect(document.querySelector(".error")!.textContent).toContain("invitación activa");
    expect(text()).toContain("Invitación activa de Ana");
  });

  it("Vista de invitado: shows name, start and schedule", async () => {
    at("/invite/tok");
    const api = mockApi({"POST /invite/tok": {body: {race: {name: "Noche Naranja", start_label: "Zócalo", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z"}, confirmed: false}}});
    await render(<App />);
    expect(api.calls.map(c => c.key)).toEqual(["POST /invite/tok"]);
    expect(text()).toContain("Noche Naranja");
    expect(text()).toContain("Zócalo");
    expect(text()).toContain("Horario");
  });

  it("Vista de invitado: the rider confirms participation", async () => {
    at("/invite/tok");
    const api = mockApi({"POST /invite/tok": {body: {race: {name: "Noche", start_label: "Zócalo", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z"}, confirmed: false}},
      "POST /invite/tok/confirm": {body: {confirmed: true}}});
    await render(<App />);
    await click(button("Confirmo que participo"));
    expect(api.calls.map(c => c.key)).toContain("POST /invite/tok/confirm");
    expect(text()).toContain("Participación confirmada");
  });

  it("Vista de invitado 404: safe state without race data", async () => {
    at("/invite/bad");
    const api = mockApi({"POST /invite/bad": {status: 404, body: {detail: "invalid"}}});
    await render(<App />);
    expect(text()).toContain("Invitación no disponible");
    expect(api.calls.map(c => c.key)).toEqual(["POST /invite/bad"]);
  });

  it("Superadmin: creates an admin that shows in the list; 409 visible", async () => {
    let admins = [{id: 1, email: "boss@x.mx", role: "superadmin", created_at: ""}];
    let duplicate = false;
    mockApi({
      "GET /auth/me": {body: {...admin, role: "superadmin"}}, "GET /races": {body: []},
      "GET /admin/organizers": () => ({body: admins}),
      "POST /admin/organizers": () => {
        if (duplicate) return {status: 409, body: {detail: "An organizer with this email already exists"}};
        admins = [...admins, {id: 2, email: "nuevo@x.mx", role: "admin", created_at: ""}];
        return {status: 201, body: admins[1]};
      },
    });
    await render(<App />);
    await type(field("Email del nuevo admin"), "nuevo@x.mx");
    await submit(button("Crear admin").closest("form")!);
    expect(document.querySelector('[aria-labelledby="admins-title"]')!.textContent).toContain("nuevo@x.mx");
    duplicate = true;
    await type(field("Email del nuevo admin"), "nuevo@x.mx");
    await submit(button("Crear admin").closest("form")!);
    expect(document.querySelector('[aria-labelledby="admins-title"] .error')!.textContent).toContain("Ya existe un organizador");
  });

  it("Superadmin section is hidden for admins", async () => {
    const api = mockApi({"GET /auth/me": {body: admin}, "GET /races": {body: []}});
    await render(<App />);
    await flush();
    expect(text()).not.toContain("Administradores");
    expect(api.calls.some(c => c.key.includes("/admin/"))).toBe(false);
  });

  const published = (invites: () => object[], extra: Record<string, unknown> = {}) => mockApi({
    "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno", "published")]},
    "GET /races/1/checkpoints": {body: []}, "GET /races/1/riders": {body: [{id: 5, name: "Ana", phone: "555"}]},
    "GET /races/1/invitations": () => ({body: invites()}), ...extra,
  } as Parameters<typeof mockApi>[0]);
  const inv = (id: number, state: string) => ({id, rider_id: 5, channel: "whatsapp", expires_at: "2026-11-05T00:00:00Z", delivery_status: state, state});

  it("Excel: uploads the file as-is, reports what was added, and lists the rows to fix", async () => {
    let reply: {status?: number; body: unknown} = {body: {added: 3, skipped: 1}};
    const api = published(() => [], {"POST /races/1/riders/import": () => reply});
    await render(<App />);
    await click(button("Uno"));
    const pick = async (file: File) => {
      const input = field("Archivo de Excel");
      Object.defineProperty(input, "files", {configurable: true, value: [file]});
      await act(async () => input.dispatchEvent(new Event("change", {bubbles: true})));
      await flush();
    };
    const file = new File(["xlsx"], "padron.xlsx");
    await pick(file);
    expect(api.calls.find(c => c.key === "POST /races/1/riders/import")!.body).toBe(file);
    expect(text()).toContain("Se añadieron 3 corredores al padrón; 1 ya estaban");
    reply = {status: 422, body: {detail: [{loc: ["body", "row-3"], msg: "Email or phone is required"}, {loc: ["body", "row-7"], msg: "Rider name cannot be blank"}]}};
    await pick(file);
    expect(text()).toContain("No se cargó nadie");
    expect(text()).toContain("Fila 3: Indica un email o un teléfono.");
    expect(text()).toContain("Fila 7: Escribe el nombre del corredor.");
  });

  it("Reenviar: the new link appears for the replacement invitation", async () => {
    let list = [inv(9, "sent")];
    published(() => list, {"POST /invitations/9/resend": () => {
      list = [inv(9, "expired"), inv(10, "sent")];
      return {body: {id: 10, delivery_status: "link_ready", state: "sent", expires_at: "2026-11-05T00:00:00Z", link: "https://app/invite/new"}};
    }});
    await render(<App />);
    await click(button("Uno"));
    await click(button("Reenviar"));
    const rows = [...document.querySelectorAll(".list li.stack")];
    expect(rows[0].querySelector("input[readonly]")).toBeNull();
    expect(rows[1].querySelector<HTMLInputElement>("input[readonly]")!.value).toBe("https://app/invite/new");
  });

  it("Carrera terminada: invitar o reenviar muestra «La carrera ya terminó»", async () => {
    const ended = {status: 422, body: {detail: "Race has already ended"}};
    published(() => [inv(9, "sent")], {"POST /invitations/9/resend": ended, "POST /races/1/invitations": ended});
    await render(<App />);
    await click(button("Uno"));
    await click(button("Reenviar"));
    expect(text()).toContain("La carrera ya terminó.");
    await cleanup();
    published(() => [], {"POST /races/1/invitations": ended});
    await render(<App />);
    await click(button("Uno"));
    await type(field("Corredor"), "5");
    await submit(button("Invitar").closest("form")!);
    expect(document.querySelector(".error")!.textContent).toContain("La carrera ya terminó.");
  });

  it("Revocar: asks first, then the row shows Revocada without actions", async () => {
    let list = [inv(9, "sent")];
    const api = published(() => list, {"POST /invitations/9/revoke": () => { list = [inv(9, "revoked")]; return {body: {status: "revoked"}}; }});
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await render(<App />);
    await click(button("Uno"));
    await click(button("Revocar"));
    expect(api.calls.some(c => c.key.endsWith("/revoke"))).toBe(false);
    await click(button("Revocar"));
    expect(confirm).toHaveBeenCalledTimes(2);
    const row = document.querySelector(".list li.stack")!;
    expect(row.textContent).toContain("Revocada");
    expect(row.querySelector("button")).toBeNull();
  });

  it("Crear carrera: sends UTC ISO dates and numeric coordinates, then selects the new race", async () => {
    const api = mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: []},
      "POST /races": {body: race(3, "Nueva")}, "GET /races/3/checkpoints": {body: []},
      "GET /races/3/riders": {body: []}, "GET /races/3/invitations": {body: []},
    });
    await render(<App />);
    await click(button("Nueva carrera"));
    await type(field("Nombre"), "Nueva");
    await type(field("Zona de salida"), "Zócalo");
    await type(field("Inicio (hora local)"), "2026-11-01T20:00");
    await type(field("Fin (hora local)"), "2026-11-01T23:00");
    await submit(button("Crear borrador").closest("form")!);
    const body = api.calls.find(c => c.key === "POST /races")!.body as Record<string, unknown>;
    expect(body.starts_at).toBe(new Date("2026-11-01T20:00").toISOString());
    expect(String(body.ends_at)).toMatch(/Z$/);
    expect(typeof body.latitude).toBe("number");
    expect(typeof body.longitude).toBe("number");
    expect(document.getElementById("race-title")!.textContent).toContain("Nueva");
  });

  it("Crear carrera: a blank coordinate is rejected client-side, not sent as 0", async () => {
    const api = mockApi({"GET /auth/me": {body: admin}, "GET /races": {body: []}});
    await render(<App />);
    await click(button("Nueva carrera"));
    await type(field("Latitud de salida"), "");
    await submit(button("Crear borrador").closest("form")!);
    expect(field("Latitud de salida").parentElement!.textContent).toContain("Indica un número");
    expect(api.calls.some(c => c.key === "POST /races")).toBe(false);
  });

  it("Editar carrera: a successful save updates the editor", async () => {
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno")]}, "GET /races/1/checkpoints": {body: []},
      "GET /races/1/riders": {body: []}, "GET /races/1/invitations": {body: []},
      "PUT /races/1": {body: race(1, "Uno bis")},
    });
    await render(<App />);
    await click(button("Uno"));
    await submit(field("Fin (hora local)").closest("form")!);
    expect(document.getElementById("race-title")!.textContent).toContain("Uno bis");
  });

  it("Añadir corredor: blank contact is null, rider preselected; 422 lands under the field", async () => {
    let reject = false;
    const api = published(() => [], {"POST /races/1/riders": () => reject
      ? {status: 422, body: {detail: [{loc: ["body", "name"], msg: "Rider name cannot be blank"}]}}
      : {body: {id: 6, name: "Beto", email: null, phone: "777"}}});
    await render(<App />);
    await click(button("Uno"));
    const panel = document.querySelector('[aria-labelledby="invites-title"]')!;
    await type(field("Nombre", panel), "Beto");
    await type(field("Teléfono", panel), "777");
    await submit(button("Añadir corredor").closest("form")!);
    expect(api.calls.find(c => c.key === "POST /races/1/riders")!.body).toEqual({name: "Beto", email: null, phone: "777"});
    expect(field("Corredor", panel).value).toBe("6");
    reject = true;
    await type(field("Teléfono", panel), "1");
    await submit(button("Añadir corredor").closest("form")!);
    expect(field("Nombre", panel).parentElement!.textContent).toContain("Escribe el nombre del corredor.");
  });

  it("Superadmin: 422 lands under the email field; roles are labelled", async () => {
    mockApi({
      "GET /auth/me": {body: {...admin, role: "superadmin"}}, "GET /races": {body: []},
      "GET /admin/organizers": {body: [{id: 1, email: "boss@x.mx", role: "superadmin", created_at: ""}]},
      "POST /admin/organizers": {status: 422, body: {detail: "A valid email is required"}},
    });
    await render(<App />);
    expect(text()).toContain("Superadmin");
    await type(field("Email del nuevo admin"), "nope");
    await submit(button("Crear admin").closest("form")!);
    expect(field("Email del nuevo admin").parentElement!.textContent).toContain("Escribe un email válido.");
  });

  it("401 mid-session sends the user back to the login", async () => {
    mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [race(1, "Uno")]},
      "GET /races/1/checkpoints": {status: 401, body: {detail: "Organizer authentication required"}},
      "GET /races/1/riders": {status: 401, body: {}}, "GET /races/1/invitations": {status: 401, body: {}},
    });
    await render(<App />);
    await click(button("Uno"));
    expect(text()).toContain("Acceso para organizadores");
    expect(text()).not.toContain("Mis carreras");
  });

  it("Malformed link escapes show the safe invalid state without calling the API", async () => {
    at("/invite/%E0%A4%A");
    const api = mockApi({});
    await render(<App />);
    expect(text()).toContain("Invitación no disponible");
    expect(api.calls).toEqual([]);
  });

  it("Network failure on a link offers a retry instead of calling it invalid", async () => {
    at("/invite/tok");
    let down = true;
    const api = mockApi({"POST /invite/tok": () => ({body: {race: {name: "Noche", start_label: "Z", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z"}}})});
    api.fetchMock.mockImplementationOnce(async () => { if (down) throw new TypeError("offline"); return new Response(); });
    await render(<App />);
    expect(text()).not.toContain("Invitación no disponible");
    down = false;
    await click(button("Reintentar"));
    expect(text()).toContain("Noche");
  });

  const guestRace = {name: "Noche", start_label: "Z", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z", checkpoints_release_at: "2026-11-01T17:50:00Z"};
  const guestPins = [{name: "Zócalo", latitude: 19.432608, longitude: -99.133209}, {name: "Ángel", latitude: 19.427025, longitude: -99.167671}];

  it("Invitado antes de la liberación: release time, no pins, then pins appear by themselves within 30 s", async () => {
    vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
    at("/invite/tok");
    let released = false;
    const api = mockApi({"POST /invite/tok": () => ({body: {race: released ? {...guestRace, checkpoints: guestPins} : guestRace, confirmed: false}})});
    await render(<App />);
    expect(text()).toContain(`se publican a las ${formatRelease(guestRace.checkpoints_release_at)}`);
    expect(text()).not.toContain("Zócalo (");
    expect(document.querySelector(".leaflet-marker-icon")).toBeNull();
    released = true;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(api.calls.map(c => c.key)).toEqual(["POST /invite/tok", "POST /invite/tok"]);
    expect(text()).toContain("Zócalo (19.43261, -99.13321)");
    expect(text()).not.toContain("se publican a las");
  });

  it("Invitado después: map pins and an alphabetical lat/lng list, no numbering", async () => {
    at("/invite/tok");
    mockApi({"POST /invite/tok": {body: {race: {...guestRace, checkpoints: guestPins}, confirmed: false}}});
    await render(<App />);
    const items = [...document.querySelectorAll(".list li")].map(li => li.textContent);
    expect(items).toEqual(["Ángel (19.42703, -99.16767)", "Zócalo (19.43261, -99.13321)"]);
    expect(document.querySelectorAll(".leaflet-marker-icon").length).toBe(2);
    expect(document.querySelector("ol")).toBeNull();
  });

  it("Liberar ahora: asks first, POSTs, then shows released with no way to hide", async () => {
    const api = published(() => [], {"POST /races/1/release-checkpoints": {body: {...race(1, "Uno", "published"), checkpoints_released: true}}});
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await render(<App />);
    await click(button("Uno"));
    expect(text()).toContain(`Se liberan a las ${formatRelease("2099-11-01T17:50:00Z")}`);
    await click(button("Liberar ahora"));
    expect(api.calls.some(c => c.key.endsWith("/release-checkpoints"))).toBe(false);
    await click(button("Liberar ahora"));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.calls.filter(c => c.key === "POST /races/1/release-checkpoints").length).toBe(1);
    expect(text()).toContain("Checkpoints liberados");
    expect(text()).not.toContain("Liberar ahora");
    expect(text()).not.toMatch(/ocultar/i);
  });

  it("Minutos inválidos: 422 lands under the release-minutes field; the value is sent as a number", async () => {
    const api = mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: []},
      "POST /races": {status: 422, body: {detail: [{loc: ["body", "checkpoints_release_minutes"], msg: "Release minutes must be between 0 and 1440"}]}},
    });
    await render(<App />);
    await click(button("Nueva carrera"));
    expect(field("Liberar checkpoints").value).toBe("10");
    await type(field("Nombre"), "Nueva");
    await type(field("Zona de salida"), "Zócalo");
    await type(field("Inicio (hora local)"), "2026-11-01T20:00");
    await type(field("Fin (hora local)"), "2026-11-01T23:00");
    await type(field("Liberar checkpoints"), "2000");
    await submit(button("Crear borrador").closest("form")!);
    expect((api.calls.find(c => c.key === "POST /races")!.body as Record<string, unknown>).checkpoints_release_minutes).toBe(2000);
    const minutes = field("Liberar checkpoints");
    expect(minutes.getAttribute("aria-invalid")).toBe("true");
    expect(minutes.parentElement!.textContent).toContain("Indica entre 0 y 1440 minutos.");
  });

  it("Liberación programada: a past release shows released; an open editor flips when the time passes", async () => {
    const api = mockApi({
      "GET /auth/me": {body: admin},
      "GET /races": {body: [{...race(1, "Pasada", "published"), checkpoints_release_at: "2000-01-01T00:00:00Z"},
                            {...race(2, "Pronto", "published"), checkpoints_release_at: new Date(Date.now() + 1000).toISOString()}]},
      "GET /races/1/checkpoints": {body: []}, "GET /races/2/checkpoints": {body: []}, "GET /races/1/riders": {body: []}, "GET /races/2/riders": {body: []},
      "GET /races/1/invitations": {body: []}, "GET /races/2/invitations": {body: []},
    });
    await render(<App />);
    await click(button("Pasada"));
    expect(text()).toContain("Checkpoints liberados");
    expect(text()).not.toContain("Liberar ahora");
    await click(button("Pronto"));
    expect(text()).toContain("Liberar ahora");
    await act(async () => { await new Promise(r => setTimeout(r, 1100)); });
    await flush();
    expect(text()).toContain("Checkpoints liberados");
    expect(text()).not.toContain("Liberar ahora");
    expect(api.calls.some(c => c.key.includes("release-checkpoints"))).toBe(false);
  });

  it("Minutos: fractional or non-finite values get a Spanish field error and are not sent", async () => {
    const api = mockApi({"GET /auth/me": {body: admin}, "GET /races": {body: []}});
    await render(<App />);
    await click(button("Nueva carrera"));
    // The number input sanitizes 1e400 (Infinity) to "", which hits the blank-field message instead.
    for (const [bad, message] of [["1.5", "Indica un número entero de minutos"], ["1e400", "Indica un número"]]) {
      await type(field("Liberar checkpoints"), bad);
      await submit(button("Crear borrador").closest("form")!);
      expect(field("Liberar checkpoints").parentElement!.textContent).toContain(message);
    }
    expect(api.calls.some(c => c.key === "POST /races")).toBe(false);
  });

  it("Editar minutos: the form shows the saved value and the PUT carries it", async () => {
    const api = mockApi({
      "GET /auth/me": {body: admin}, "GET /races": {body: [{...race(1, "Uno"), checkpoints_release_minutes: 30}]},
      "GET /races/1/checkpoints": {body: []}, "GET /races/1/riders": {body: []}, "GET /races/1/invitations": {body: []},
      "PUT /races/1": {body: {...race(1, "Uno"), checkpoints_release_minutes: 30}},
    });
    await render(<App />);
    await click(button("Uno"));
    expect(field("Liberar checkpoints").value).toBe("30");
    await submit(field("Liberar checkpoints").closest("form")!);
    expect((api.calls.find(c => c.key === "PUT /races/1")!.body as Record<string, unknown>).checkpoints_release_minutes).toBe(30);
  });

  it("Invitado: a failed refresh keeps the page and retries in 5 s; a later 404 shows the invalid state", async () => {
    vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
    at("/invite/tok");
    let gone = false;
    const api = mockApi({"POST /invite/tok": () => (gone ? {status: 404, body: {detail: "invalid"}} : {body: {race: guestRace, confirmed: false}})});
    await render(<App />);
    api.fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(text()).toContain("Noche");
    expect(text()).toContain(`se publican a las ${formatRelease(guestRace.checkpoints_release_at)}`);
    expect(text()).not.toContain("Reintentar");
    gone = true;
    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flush();
    expect(api.fetchMock).toHaveBeenCalledTimes(3); // the rejected refresh never reaches api.calls
    expect(text()).toContain("Invitación no disponible");
  });
});

describe("race day: checkpoint QR and help", () => {
  const summary = {race: {name: "Noche", start_label: "Zócalo", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z",
    checkpoints_release_at: "2026-11-01T17:50:00Z"}, confirmed: false};
  afterEach(() => { localStorage.clear(); });

  const gps = (coords: {latitude: number; longitude: number} | null) => Object.defineProperty(navigator, "geolocation", {configurable: true,
    value: {getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) =>
      coords ? ok({coords} as GeolocationPosition) : fail({code: 1} as GeolocationPositionError)}});
  const openInvitation = async () => {
    mockApi({"POST /invite/tok": {body: summary}});
    at("/invite/tok");
    await render(<App />);
    await cleanup();
  };

  it("a scanned QR checks in with this phone's invitation and position", async () => {
    await openInvitation();
    gps({latitude: 19.41, longitude: -99.11});
    at("/checkin/qr1");
    const {calls} = mockApi({"POST /invite/tok/checkins": {body: {checkpoint: "Fuente", checked_in_at: "2026-11-01T18:30:00Z"}}});
    await render(<App />);
    expect(calls).toEqual([{key: "POST /invite/tok/checkins", body: {code: "qr1", latitude: 19.41, longitude: -99.11}}]);
    expect(text()).toContain("Checkpoint registrado");
    expect(text()).toContain("Fuente");
  });

  it("a scan too far away is refused with a retry, and no GPS means nothing is sent", async () => {
    await openInvitation();
    gps({latitude: 19.5, longitude: -99.11});
    at("/checkin/qr1");
    mockApi({"POST /invite/tok/checkins": {status: 422, body: {detail: "Too far from the checkpoint"}}});
    await render(<App />);
    expect(text()).toContain("Estás demasiado lejos del checkpoint");
    button("Reintentar");
    await cleanup();
    gps(null);
    const {calls} = mockApi({});
    await render(<App />);
    expect(calls).toEqual([]);
    expect(text()).toContain("No se pudo obtener tu ubicación");
  });

  it("a QR scanned without an opened invitation asks to open it first and calls nothing", async () => {
    const {calls} = mockApi({});
    at("/checkin/qr1");
    await render(<App />);
    expect(calls).toEqual([]);
    expect(text()).toContain("Abre primero tu invitación");
  });

  it("a help button sends the kind with the position after confirmation", async () => {
    const {calls} = mockApi({"POST /invite/tok": {body: summary}, "POST /invite/tok/help": {status: 201, body: {id: 1}}});
    vi.stubGlobal("confirm", () => true);
    Object.defineProperty(navigator, "geolocation", {configurable: true,
      value: {getCurrentPosition: (ok: PositionCallback) => ok({coords: {latitude: 19.4, longitude: -99.1}} as GeolocationPosition)}});
    at("/invite/tok");
    await render(<App />);
    await click(button("Problema mecánico"));
    expect(calls.at(-1)).toEqual({key: "POST /invite/tok/help", body: {kind: "mechanical", latitude: 19.4, longitude: -99.1}});
    expect(text()).toContain("Solicitud enviada con tu ubicación");
  });
});

describe("race-day board", () => {
  afterEach(cleanup);
  const data = {
    race: {id: 1, name: "Noche", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z"},
    checkpoints: [{id: 11, name: "A"}, {id: 12, name: "B"}],
    riders: [{id: 1, name: "Zoe"}, {id: 2, name: "Ana"}, {id: 3, name: "Beto"}],
    checkins: [
      {rider_id: 1, checkpoint_id: 11, checked_in_at: "2026-11-01T18:20:00Z"}, {rider_id: 1, checkpoint_id: 12, checked_in_at: "2026-11-01T18:40:00Z"},
      {rider_id: 3, checkpoint_id: 11, checked_in_at: "2026-11-01T18:10:00Z"}, {rider_id: 3, checkpoint_id: 12, checked_in_at: "2026-11-01T18:50:00Z"},
    ],
    help: [{id: 9, rider: "Ana", phone: "+5255", kind: "medical", latitude: null, longitude: null, created_at: "2026-11-01T18:45:00Z", resolved_at: null}],
  };

  it("ranks by checkpoints reached, then by who reached the last one first", () => {
    expect(standings(data as never).map(r => r.rider.name)).toEqual(["Zoe", "Beto", "Ana"]);
  });

  it("the finish is its own column and does not count as a checkpoint", async () => {
    const withFinish = {...data, checkpoints: [...data.checkpoints, {id: 13, name: "Meta", finish: true}],
      checkins: [...data.checkins, {rider_id: 2, checkpoint_id: 13, checked_in_at: "2026-11-01T19:00:00Z"}]};
    expect(standings(withFinish as never).map(r => [r.rider.name, r.visits.size, !!r.finished])).toEqual([["Zoe", 2, false], ["Beto", 2, false], ["Ana", 0, true]]);
    mockApi({"GET /races/1/board": {body: withFinish}});
    at("/tablero/1");
    await render(<App />);
    expect([...document.querySelectorAll(".board-table th")].map(th => th.textContent)).toEqual(["#", "Corredor", "A 2/3", "B 2/3", "Total", "Meta 1/3"]);
  });

  it("shows the grid and open help, and asks to log in without a session", async () => {
    mockApi({"GET /races/1/board": {body: data}});
    at("/tablero/1");
    await render(<App />);
    expect(text()).toContain("AUXILIO · Emergencia médica");
    expect(document.querySelectorAll("td.hit")).toHaveLength(4);
    const podium = [...document.querySelectorAll(".board-podium li")].map(li => li.textContent);
    expect(podium).toHaveLength(2); // Ana has no checkpoints yet, so she is not on the podium
    expect(podium[0]).toContain("Zoe");
    expect(podium[0]).toContain("Líder virtual");
    expect(text()).not.toContain("Ganador:");
    await cleanup();
    mockApi({"GET /races/1/board": {body: {...data, race: {...data.race, winner_rider_id: 3}}}});
    await render(<App />);
    expect(text()).toContain("Ganador: Beto"); // the organizers' call, even though Zoe leads on checkpoints
    await cleanup();
    mockApi({"GET /races/1/board": {status: 401, body: {detail: "Organizer authentication required"}}});
    await render(<App />);
    expect(text()).toContain("El tablero es solo para organizadores");
  });
});
