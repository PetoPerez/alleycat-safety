// One jsdom test per I/O-matrix row of spec-web-ui-race-administration.md, with fetch mocked.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {App} from "./App";
import {button, cleanup, click, field, flush, mockApi, render, submit, text, type} from "./test/dom";

const race = (id: number, name: string, status = "draft") => ({
  id, name, status, start_label: `Salida ${name}`, latitude: 19.43, longitude: -99.13,
  starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z",
});
const admin = {id: 1, email: "org@x.mx", role: "admin"};
const at = (path: string) => history.replaceState(null, "", path);

beforeEach(() => at("/"));
afterEach(cleanup);

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
      "GET /riders": {body: []}, "GET /races/1/invitations": {body: []},
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
      "GET /riders": {body: [{id: 5, name: "Ana", email: "a@x"}]},
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
      "GET /riders": {body: []}, "GET /races/1/invitations": {body: []}, "GET /races/2/invitations": {body: []},
    });
    await render(<App />);
    await click(button("Uno"));
    expect(button("Añadir checkpoint").disabled).toBe(true); // no point chosen yet: never defaults to the start
    await type(field("Latitud del checkpoint"), "19.43");
    await type(field("Longitud del checkpoint"), "-99.13");
    await type(field("Etiqueta del checkpoint"), "Puente");
    await submit(field("Etiqueta del checkpoint").closest("form")!);
    expect(api.calls.find(c => c.key === "POST /races/1/checkpoints")!.body).toEqual({name: "Puente", latitude: 19.43, longitude: -99.13});
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
      "GET /riders": {body: []}, "GET /races/1/invitations": {body: []},
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
      "GET /riders": {body: []}, "GET /races/1/invitations": {body: []},
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
      "GET /riders": {body: []}, "GET /races/1/invitations": {body: []},
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
      "GET /riders": {body: [{id: 5, name: "Ana", phone: "555"}]},
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
    const api = mockApi({"POST /invite/tok": {body: {race: {name: "Noche Naranja", start_label: "Zócalo", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T21:00:00Z"}, next: "later"}}});
    await render(<App />);
    expect(api.calls.map(c => c.key)).toEqual(["POST /invite/tok"]);
    expect(text()).toContain("Noche Naranja");
    expect(text()).toContain("Zócalo");
    expect(text()).toContain("Horario");
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
    "GET /races/1/checkpoints": {body: []}, "GET /riders": {body: [{id: 5, name: "Ana", phone: "555"}]},
    "GET /races/1/invitations": () => ({body: invites()}), ...extra,
  } as Parameters<typeof mockApi>[0]);
  const inv = (id: number, state: string) => ({id, rider_id: 5, channel: "whatsapp", expires_at: "2026-11-05T00:00:00Z", delivery_status: state, state});

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
      "GET /riders": {body: []}, "GET /races/3/invitations": {body: []},
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
      "GET /riders": {body: []}, "GET /races/1/invitations": {body: []},
      "PUT /races/1": {body: race(1, "Uno bis")},
    });
    await render(<App />);
    await click(button("Uno"));
    await submit(field("Fin (hora local)").closest("form")!);
    expect(document.getElementById("race-title")!.textContent).toContain("Uno bis");
  });

  it("Añadir corredor: blank contact is null, rider preselected; 422 lands under the field", async () => {
    let reject = false;
    const api = published(() => [], {"POST /riders": () => reject
      ? {status: 422, body: {detail: [{loc: ["body", "name"], msg: "Rider name cannot be blank"}]}}
      : {body: {id: 6, name: "Beto", email: null, phone: "777"}}});
    await render(<App />);
    await click(button("Uno"));
    const panel = document.querySelector('[aria-labelledby="invites-title"]')!;
    await type(field("Nombre", panel), "Beto");
    await type(field("Teléfono", panel), "777");
    await submit(button("Añadir corredor").closest("form")!);
    expect(api.calls.find(c => c.key === "POST /riders")!.body).toEqual({name: "Beto", email: null, phone: "777"});
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
      "GET /riders": {status: 401, body: {}}, "GET /races/1/invitations": {status: 401, body: {}},
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
});
