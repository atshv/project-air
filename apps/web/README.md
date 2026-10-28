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
