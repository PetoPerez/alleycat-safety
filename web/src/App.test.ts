import {describe, expect, it} from "vitest";
import {route} from "./App";

describe("route by pathname", () => {
  it("sends invitation and magic links to their views and everything else to the app", () => {
    expect(route("/invite/abc")).toEqual({view: "invite", token: "abc"});
    expect(route("/auth/consume/xyz")).toEqual({view: "consume", token: "xyz"});
    expect(route("/checkin/qr1")).toEqual({view: "checkin", token: "qr1"});
    expect(route("/tablero/7")).toEqual({view: "board", token: "7"});
    expect(route("/")).toEqual({view: "app"});
    expect(route("/invite/")).toEqual({view: "app"});
    expect(route("/races")).toEqual({view: "app"});
    expect(route("/invite/a/b")).toEqual({view: "app"});
    expect(route("/invite/%E0%A4%A")).toEqual({view: "invite", token: null}); // malformed escape must not throw
  });
});
