# apps/web

The product UI.

- **Kind:** `app`
- **Created in stage:** `later`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Commands (P6-01)

- `pnpm --filter ./apps/web dev` — Vite dev server on the slot's `web` port (4300 in slot 3; env `WEB_PORT` overrides).
- `pnpm --filter ./apps/web build` — production build into `apps/web/dist`.
- `pnpm --filter ./apps/web preview` — preview server on the slot's `web-e2e` port (4301; env `WEB_E2E_PORT` overrides).
- `pnpm --filter ./apps/web typecheck` / `lint` / `test` — TypeScript check, ESLint and the pure `node --test` suites (i18n language/parity/persistence, route helpers).

The app is client-rendered (ADR-0013); it imports UI values only from
`packages/ui-kit` and visible text only from `apps/web/messages` (German default,
English switch, persisted choice, `<html lang>` updated). Later routes render an
honest "not connected yet" empty state until their tasks land.

## Auth in the web app (P6-02)

The app reaches auth only through `packages/sdk` (`createClient({ baseUrl, authBaseUrl })`):
`auth.getSession()` probes `GET /v1/session`, and `auth.login/registration/recovery/logout`
call the auth service's `/v1/auth/*` routes with `credentials: "include"`. The session stays
in the provider's HttpOnly cookie; nothing is written to `localStorage`/`sessionStorage`.

Local run (slot 3, Kratos via the compose `identity` profile, Mailpit for mail):

```
docker compose -f infra/compose/compose.yaml --profile identity up -d
pnpm --filter @project-air/platform dev
pnpm --filter @project-air/auth dev
pnpm --filter ./apps/web dev
```

The Vite dev proxy forwards `/v1/auth` to the slot auth port (4320) and every other
`/v1` route to the platform port (4310), so cookies are same-origin. The ports come from
`.polier-slot`; `AUTH_URL`/`PLATFORM_URL` override them for e2e. In production the app and
both `/v1` prefixes must be served from the same origin (or the auth cookie must be set for
the app's domain with `SameSite`/`Secure` accordingly). Login/registration/recovery pages
mirror the server validation; the server stays authoritative.
