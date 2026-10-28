import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ports come from the slot (never hardcoded); env overrides are for e2e runs.
function slotPorts(): { web: number; e2e: number } {
  const slotPath = fileURLToPath(new URL("../../.polier-slot", import.meta.url));
  const slot = JSON.parse(readFileSync(slotPath, "utf8")) as { ports: { web: number; "web-e2e": number } };
  return { web: slot.ports.web, e2e: slot.ports["web-e2e"] };
}

export default defineConfig(() => {
  const ports = slotPorts();
  return {
    plugins: [react()],
    server: {
      port: Number(process.env["WEB_PORT"] ?? ports.web),
      strictPort: true,
      fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    },
    preview: { port: Number(process.env["WEB_E2E_PORT"] ?? ports.e2e), strictPort: true },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
