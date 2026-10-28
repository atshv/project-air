import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ports come from the slot (never hardcoded); env overrides are for e2e runs.
function slotPorts(): { web: number; e2e: number; platform: number; auth: number } {
  const slotPath = fileURLToPath(new URL("../../.polier-slot", import.meta.url));
  const slot = JSON.parse(readFileSync(slotPath, "utf8")) as { ports: { web: number; "web-e2e": number; platform: number; auth: number } };
  return { web: slot.ports.web, e2e: slot.ports["web-e2e"], platform: slot.ports.platform, auth: slot.ports.auth };
}

export default defineConfig(() => {
  const ports = slotPorts();
  return {
    plugins: [react()],
    // Same-origin cookies in development: /v1/auth goes to the auth service,
    // every other /v1 route (session, platform API) to the platform service.
    server: {
      port: Number(process.env["WEB_PORT"] ?? ports.web),
      strictPort: true,
      fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
      proxy: {
        "/v1/auth": { target: process.env["AUTH_URL"] ?? `http://127.0.0.1:${ports.auth}`, changeOrigin: false },
        "/v1": { target: process.env["PLATFORM_URL"] ?? `http://127.0.0.1:${ports.platform}`, changeOrigin: false },
      },
    },
    preview: { port: Number(process.env["WEB_E2E_PORT"] ?? ports.e2e), strictPort: true },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
