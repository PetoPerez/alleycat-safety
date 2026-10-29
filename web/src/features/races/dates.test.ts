(globalThis as unknown as {process: {env: Record<string, string>}}).process.env.TZ = "America/Mexico_City"; // UTC-6, no DST
import {describe, expect, it} from "vitest";
import {fromLocalInput, toLocalInput} from "./mapUtils";

describe("local <-> UTC", () => {
  it("shows API UTC times as local wall time", () => {
    expect(toLocalInput("2026-11-01T18:30:00Z")).toBe("2026-11-01T12:30");
    expect(toLocalInput("2026-11-01T18:30:00+00:00")).toBe("2026-11-01T12:30");
    expect(toLocalInput("2026-11-01T18:30:00")).toBe("2026-11-01T12:30");
  });
  it("sends local wall time as ISO UTC with zone", () => {
    expect(fromLocalInput("2026-11-01T12:30")).toBe("2026-11-01T18:30:00.000Z");
  });
  it("round-trips without drift", () => {
    const iso = "2026-11-01T18:30:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });
});
