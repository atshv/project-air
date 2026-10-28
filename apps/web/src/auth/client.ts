import { createClient } from "../../../../packages/sdk/src/index.ts";

// Same-origin in dev via the Vite proxy; auth and session share the origin.
const origin = typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin;
export const api = createClient({ baseUrl: origin, authBaseUrl: origin });
