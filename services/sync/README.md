# services/sync

WebSocket realtime, CRDT exchange, presence.

- **Kind:** `service`
- **Created in stage:** `later`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Browser session handshake (P6-09)

The board page opens `ws(s)://<app-origin>/v1/sync`; the Vite dev proxy and the
production same-origin deployment forward the WebSocket upgrade together with the
browser session cookie (`HttpOnly`, never read by JavaScript). The service reads the
`Cookie` request header once per upgrade (`src/service.ts`) and hands it to the
injected adapters (`src/session-auth.ts`); it is never logged and only ever sent to
the configured `AUTH_SERVICE_URL` and `PLATFORM_SERVICE_URL`:

1. `GET <AUTH_SERVICE_URL>/session` — the single session check (AD-5); the auth
   service forwards the cookie to Ory Kratos. A rejected/expired session makes the
   `hello` answer `reject { code: "AUTH_REQUIRED" }` and the socket stays
   unauthenticated (no board data is sent).
2. The session user id is the contract account id. The auth service reports the
   Ory Kratos identity id, which may be a UUIDv4, so a non-v7 identity is resolved
   through `GET <PLATFORM_SERVICE_URL>/v1/session` with the same credentials.
3. `joinBoard` keeps the existing platform authorization: the authorizer asks
   `GET <PLATFORM_SERVICE_URL>/v1/boards/<boardId>` with the same cookie (the
   platform enforces membership and row-level security). No client-sent user id is
   trusted.

The `hello` `tokenRef` path stays for tests and non-browser clients: without a
cookie it is forwarded as the auth service's `x-test-session` header, which only
works when `AUTH_TEST_MODE=1`; a browser sends the opaque reference
`browser-session`, which carries no token.

`AUTH_SERVICE_URL` and `PLATFORM_SERVICE_URL` come from the slot/dev environment;
`SYNC_PORT` and `DATABASE_URL` name the rest. `pnpm --filter @project-air/sync build`
then `node services/sync/dist/index.js` starts the built entry; it resolves the
built CRDT at `packages/crdt/dist/packages/crdt/src/index.js`.
