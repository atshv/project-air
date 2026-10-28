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

## Boards start page (P6-03)

`/boards` resolves the session, lists workspaces through the SDK, keeps the selected workspace
in `project-air.workspaceId` (localStorage) and lists its boards with title, visibility and
`updatedAt` formatted by `Intl.DateTimeFormat` for the active language. It creates/renames/deletes
boards through the SDK (dialogs with title validation: trimmed, 1…120 characters), offers the
first-run flow (create a workspace, then its first board) when the account has none, and shows
skeleton/empty/error-with-retry/in-flight states. A board opens at `/boards/:id`; a missing or
forbidden board redirects back to `/boards`. The SDK is the only data path (no fetch/service
import in the app); all text comes from `apps/web/messages`. First-page listing is enough for this
stage (`nextCursor` stays in the SDK type contract).

## Board page host (P6-04)

`/boards/:id` loads the board metadata via the SDK (`boards.get`), mounts the engine on a canvas
sized by ResizeObserver/DPR (WebGL2 default; WebGPU only when requested and an adapter exists,
otherwise a fail-closed WebGL2 fallback), restores the L17 camera per board/device through the
engine view-persistence key and falls back to the engine fit when no record exists, and destroys
the engine/observer/sync client on unmount. One SDK `BoardSyncClient` owns the board document:
snapshot content is projected into the engine document port and remote operations apply through
it; the toolbar (L00) is a top-centre icon bar with grouped 36 px buttons, one accent selection,
`aria-pressed`/`aria-label`/`data-label` from messages, and +/−/fit zoom controls. The engine
package exports the logic modules used by the app (`./logic/operations.js`,
`./logic/document-port.js`, `./logic/history.js`, `./bridge/view-persistence.js`). The Vite dev
proxy forwards `/v1/sync` as a WebSocket (`ws: true`) to the slot sync port, and `/v1`/`/v1/auth`
to platform/auth, so cookies and the sync socket are same-origin in development.

### P6-04 limits (explicit)

- **Sync authentication is not wired yet:** the browser session cookie / hello
  handshake for the sync service is **P6-08's** responsibility. Until then the
  board page connects with a placeholder token and live sync may be rejected.
- **Browser proof is P6-09 e2e:** engine mount/rendering, WebGL2/WebGPU
  selection, /v1/sync WebSocket, remote-operation application, gesture -> one
  operation and view restore across reload are not exercised by this task's
  tests (they are typechecked/built only).
- Toolbar -> engine tool binding and pointer gesture mapping stay P6-05; P6-04
  only selects the active tool state.

## Board interactions (P6-05)

The board page implements the L12 keyboard map (Cmd/Ctrl+D duplicate card+note as one group
operation with inverse, Delete/Backspace delete, Esc close, arrows 16 px / Shift 160 px grouped
into one operation after a 300 ms burst), the right-click L12 context menu (200 px, 32 px items
Open/Duplicate/Bring forward/Send backward/Delete with muted shortcuts, roving focus, Escape and
focus restored to the canvas), and the L11 undo/redo UI (Cmd/Ctrl+Z / Shift variant as the SDK's
own-op history only — no parallel engine-history writer — with a bottom-centre 3 s "Undo: …"
hint). Shortcuts are suppressed while an input/textarea/contenteditable/dialog owns focus. Bring/
Send use the contract `reorder` with fractional z and its inverse; duplicate is card+note group
operation with inverse (multi-select duplicate stays disabled with a message, recorded gap).
Browser/DOM behaviour is P6-09 e2e and not claimed here; live sync auth remains P6-08.
