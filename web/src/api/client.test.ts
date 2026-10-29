import {afterEach, describe, expect, it, vi} from "vitest";
import {ApiError, request, setOnUnauthorized, toApiError} from "./client";

afterEach(() => { vi.unstubAllGlobals(); setOnUnauthorized(undefined); });

describe("ApiError parsing", () => {
  it("maps FastAPI 422 lists to Spanish fields by the last loc segment", () => {
    const error = toApiError(422, [{loc: ["body", "ends_at"], msg: "End time must be after start time"}, {loc: ["body", "name"], msg: "Name cannot be blank"}]);
    expect(error.fields).toEqual({ends_at: "El fin debe ser posterior al inicio.", name: "Escribe un nombre."});
    expect(error.message).toBe("El fin debe ser posterior al inicio. Escribe un nombre.");
    expect(error.status).toBe(422);
  });
  it("translates string details and falls back by status, never [object Object]", () => {
    expect(toApiError(409, "Active invitation exists; resend or revoke it").message).toContain("invitación activa");
    expect(toApiError(422, "Invitation is already revoked").message).toBe("La invitación ya no está activa.");
    expect(toApiError(422, [{loc: ["body", "latitude"], msg: "Input should be a valid number"}]).fields.latitude).toBe("Revisa los datos.");
    expect(toApiError(500, undefined).message).toContain("500");
  });
});

describe("request", () => {
  it("uses relative paths, same-origin credentials, JSON bodies and handles 204", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {status: 204}));
    vi.stubGlobal("fetch", fetchMock);
    expect(await request("/races/1/checkpoints/2", {method: "DELETE"})).toBeUndefined();
    await request("/races", {method: "POST", json: {a: 1}}).catch(() => {});
    const [path, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(path).toBe("/races");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe('{"a":1}');
  });
  it("turns network failures into a readable ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(request("/auth/me")).rejects.toMatchObject({status: 0});
  });
  it("turns a 2xx non-JSON body into a readable ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", {status: 200})));
    const error = await request("/races").catch((e: ApiError) => e) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toContain("Respuesta inesperada");
  });
  it("calls the unauthorized hook on any 401", async () => {
    const hook = vi.fn();
    setOnUnauthorized(hook);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"detail":"Organizer authentication required"}', {status: 401})));
    await request("/races").catch(() => {});
    expect(hook).toHaveBeenCalledOnce();
  });
});
