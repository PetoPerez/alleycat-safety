import {act, type ReactElement} from "react";
import {createRoot, type Root} from "react-dom/client";
import {vi} from "vitest";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

type Reply = {status?: number; body?: unknown} | (() => {status?: number; body?: unknown});
/** Mock fetch by "METHOD /path". Replies may be functions so tests can change state between calls. */
export function mockApi(routes: Record<string, Reply>) {
  const calls: {key: string; body?: unknown}[] = [];
  const fetchMock = vi.fn(async (path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    calls.push({key, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body ?? undefined}); // files pass through as-is
    if (!(key in routes)) throw new Error(`unmocked ${key}`);
    const reply = routes[key];
    const {status = 200, body} = typeof reply === "function" ? reply() : reply;
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {status});
  });
  vi.stubGlobal("fetch", fetchMock);
  return {calls, fetchMock};
}

let root: Root | undefined;
let host: HTMLElement | undefined;
export async function render(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(ui));
  await flush();
  return host;
}
export async function cleanup() {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
export const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });

export const text = () => document.body.textContent ?? "";
export const byText = (tag: string, match: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLElement>(tag)].find(el => el.textContent?.includes(match));
export const button = (match: string) => {
  const el = byText("button", match) as HTMLButtonElement | undefined;
  if (!el) throw new Error(`no button ${match}`);
  return el;
};
export const field = (label: string, scope: ParentNode = document) => {
  const el = byText("label", label, scope)?.querySelector("input, select") as HTMLInputElement | undefined;
  if (!el) throw new Error(`no field ${label}`);
  return el;
};
export async function click(el: HTMLElement) {
  await act(async () => el.click());
  await flush();
}
/** Sets a value the way a user would, so React's onChange fires on controlled inputs. */
export async function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", {bubbles: true})); });
}
export async function submit(form: HTMLFormElement) {
  await act(async () => { form.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
  await flush();
}
