# Gate Catalogue: Playwright (e2e)

The web-app stage gate. One Playwright suite runs the real app against the slot services on the
slot's `web-e2e` port; it is Chromium-only, single-worker and **exclusive** (two runs against the
same slot corrupt each other).

## Gates

| Gate | Command | Expected |
| --- | --- | --- |
| `e2e` | `pnpm --filter ./apps/web exec playwright test` (repository root) | exit 0, `12 passed`, `1 skipped` (the manual Kratos spec) |
| `e2e-one` | `pnpm --filter ./apps/web exec playwright test -- e2e/note-panel.spec.ts` | exit 0, that file's specs pass |
| `e2e-report` | `pnpm --filter ./apps/web exec playwright show-report` (local only) | opens the HTML report from `apps/web/playwright-report/` |
| `e2e-manual` | `E2E_KRATOS=1 pnpm --filter ./apps/web run e2e:manual` | manual Kratos/Mailpit login spec (not part of CI) |

Run the gate through `gate.py` (it takes the task's `exclusive: ["e2e"]` lock and keeps the full log
in `reviews/evidence/`):

```bash
python3 "$POLIER/tools/gate.py" --task P6-10 --name e2e --exclusive e2e \
  --shell "pnpm --filter ./apps/web exec playwright test"
```

`e2e` is concurrent-hostile: it resets the slot database and binds the slot's `web-e2e`, platform,
auth and sync ports. Wait for the lock (or rerun alone); never start a second instance against the
same slot and never stop a server another session started (no `pkill`).

## Prerequisites (one-time per worktree)

All versions come from the manifests and are pinned in [docs/versions.md](../versions.md).

```bash
bash tools/dev/setup                                    # slot database/role/bucket + gitignored secrets
pnpm install                                            # workspace, including @playwright/test 1.64.1
bash packages/engine/tools/build-wasm.sh                # gitignored engine.js + engine.wasm
pnpm build                                              # built app (apps/web/dist) and service entrypoints
pnpm --filter ./apps/web exec playwright install chromium
```

- **Runner:** `@playwright/test` `1.64.1` (Apache-2.0) is a devDependency of `apps/web`;
  `apps/web/playwright.config.mjs` is the config. No other e2e dependency is used.
- **Browser:** Playwright `1.64.1` downloads Chromium build `1248` (Chrome `156.0.8078.4`). The
  browser cache (`~/Library/Caches/ms-playwright/chromium-1248/`) is not in the repository. When it
  is already present the install command is a no-op; on a cold machine it downloads from the pinned
  Playwright release. Never use `latest`.
- **Ports:** only from `.polier-slot` — the Playwright config reads `ports["web-e2e"]` and the
  environment server reads `web-e2e`, `platform`, `auth` and `sync`. Nothing is hardcoded; slot 0 is
  refused. Slot 3 is `web-e2e 4301`, platform `4310`, auth `4320`, sync `4330`.

## The e2e environment (one command, started by Playwright)

`apps/web/playwright.config.mjs` declares a `webServer`:

```text
node tools/dev/e2e-env.mjs      # cwd = repository root, readiness URL = <web-e2e>/healthz
```

`tools/dev/e2e-env.mjs` does everything and tears it down:

1. reads `.polier-slot` and the gitignored `infra/compose/.env`; refuses slot 0 and foreign worktrees;
2. resets and migrates **only this slot's** database with `bash tools/dev/reset-db` (so a second run
   passes without manual steps);
3. starts `services/auth` in the gated test-session mode (`NODE_ENV=test`, `AUTH_TEST_MODE=1`; Kratos
   URLs are dummy values because the test mode never calls it), `services/platform` and
   `services/sync` on the slot ports, as its own child processes;
4. mints two HMAC test sessions through `POST /test/session` and seeds, with fixed UUIDv7 ids, two
   profiles, one workspace (account B as `editor`) and one board;
5. serves the built app on the slot's `web-e2e` port and writes the gitignored state file
   `apps/web/e2e/.state/env.json` the specs read;
6. on `SIGTERM`/`SIGINT` closes the server, stops only its own processes and deletes the seeded rows
   (workspace, profiles, the run's boards and their sync log). An unexpected service exit stops the
   run with a clear error.

**Serving choice.** A small Node server (`tools/dev/e2e-server.mjs`), not `vite preview`: the app
needs same-origin `/v1` HTTP routes and the `/v1/sync` WebSocket, and the built app resolves the
engine module at `/build-wasm/engine.js`. The server serves `apps/web/dist` as an SPA, proxies
`/v1/auth/*` to auth, every other `/v1` route to platform and the `/v1/sync` upgrade to sync, and
serves `packages/engine/build-wasm/` at `/build-wasm/`. No proxy rule is hardcoded: targets come from
the slot ports.

**Authentication (gated test-mode session, no Kratos).** The harness mints `POST /test/session`
tokens for the two seeded account ids. A Playwright context carries the token as the non-HttpOnly
`air_e2e_session` cookie; the e2e server turns it into the auth service's `x-test-session` header for
`/v1` requests and strips it from the sync upgrade, where the page init script fills the contract
0.4.0 hello `tokenRef` with the same token (the protocol's documented test/non-browser path — a
browser WebSocket cannot set an auth header). `POST /v1/auth/login|logout` are served by the same
test-mode server as a shim for the seeded accounts, so the real login-page → deferred-route →
logout flow runs without Kratos. The guard itself is unchanged and server-side: the auth service
only accepts test sessions with `AUTH_TEST_MODE=1`, and refuses that mode with `NODE_ENV=production`.
The real Kratos/Mailpit login is the manual spec (below).

**Manual Kratos login.** `apps/web/e2e/manual/kratos-login.spec.ts` is skipped by default. To run it:
start the identity profile (`docker compose -f infra/compose/compose.yaml --profile identity up -d
--wait`), run auth/platform/the e2e server with the real Kratos configuration (no `AUTH_TEST_MODE`),
create the account through the registration flow/Mailpit, then run
`E2E_KRATOS=1 E2E_KRATOS_EMAIL=... E2E_KRATOS_PASSWORD=... pnpm --filter ./apps/web run e2e:manual`.
It is not part of the automated gate and CI does not depend on the identity profile.

## What the suite covers

| Spec | Flows |
| --- | --- |
| `e2e/session.spec.ts` | logged-out redirect with the intended `next` route, login returns to the board, logout and signed-out reload |
| `e2e/boards.spec.ts` | seeded workspace/board list, create a board through the dialog, open it, missing board redirects |
| `e2e/note-panel.spec.ts` | toolbar add note, L04 400 px overlay with an unchanged canvas width, Escape, empty-note placeholder, typing, title edit, reload persistence |
| `e2e/toolbar-view.spec.ts` | L00 toolbar groups, zoom in/out/fit through the persisted L17 record, reload keeps the view, a new board is fitted |
| `e2e/interactions.spec.ts` | L12 context menu (open/duplicate/bring forward/send backward/delete, disabled without selection), keyboard duplicate/delete, L11 undo/redo with the 3 s hint, shortcuts suppressed in the editor |
| `e2e/realtime.spec.ts` | two accounts edit live and converge, presence cursor visible, L05 `Saving …` → `Saved`, offline notice + kept edits + convergence after `context.setOffline(false)` |
| `e2e/manual/kratos-login.spec.ts` | optional real Kratos login (skipped) |

Selectors use roles and accessible names from the message catalogs; the tests run with the app's
English language setting (the app defaults to German). There are no CSS-structure snapshots, no
arbitrary sleeps and no retries (`retries: 0`, one worker): a flaky spec is fixed, never retried.

## Expected output and artifacts

```text
Running 14 tests using 1 worker
...
  1 skipped
  12 passed (…)
```

- `apps/web/test-results/` — per-test output, `trace.zip` and screenshots **on failure**
  (`trace: "retain-on-failure"`, `screenshot: "only-on-failure"`).
- `apps/web/playwright-report/` — HTML report (open with `show-report`).
- `apps/web/e2e/.state/env.json` — the gitignored state file the webServer writes for the specs.
- Both artifact directories are gitignored and are never committed; P6-11 owns the committed canvas
  screenshot evidence.

Debugging: `pnpm --filter ./apps/web exec playwright show-trace apps/web/test-results/<test>/trace.zip`,
or start the environment by hand with `node tools/dev/e2e-env.mjs` (prints `e2e-env: ready at …` and
stops on `SIGTERM`). A failing run always exits non-zero.

## Pitfalls

- Port collisions are the most common failure: the environment fails fast when `web-e2e` is taken.
  Read `.polier-slot`, never hard-code a port.
- The suite resets the slot database; the task's `exclusive: ["e2e"]` lock is required.
- A cold `~/.cache/ms-playwright` makes the browser install slow; install it before the gate, not
  inside a test.
- An offline browser keeps an idle WebSocket half-open and drops frames silently; the board page
  listens to the browser `offline`/`online` events and the SDK closes the socket, keeps the
  unacknowledged operations and flushes them on reconnect (that is what the L05 offline notice and
  the reconnect spec rely on).
- Kratos/mail is optional; do not make CI depend on the identity profile.
