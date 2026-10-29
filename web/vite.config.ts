/// <reference types="vitest" />
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

// Dev only: forward API calls to uvicorn on :8000, but let browser page loads
// (e.g. GET /invite/<token>, GET /auth/consume/<token>) fall through to the SPA.
const api = {
  target: "http://localhost:8000",
  bypass: (req: {method?: string; headers: {accept?: string}}) =>
    req.method === "GET" && req.headers.accept?.includes("text/html") ? "/index.html" : undefined,
};

export default defineConfig({
  plugins: [react()],
  server: {proxy: Object.fromEntries(["/auth", "/admin", "/races", "/riders", "/invitations", "/invite"].map(p => [p, api]))},
  test: {environment: "jsdom"},
});
