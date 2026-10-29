area: web
kind: minor

Add the e2e suite and the slot e2e gate (P6-10, D12): `@playwright/test` 1.64.1 (Apache-2.0, pinned
with its Chromium build 1248 in docs/versions.md) under `apps/web`, one deterministic environment
(`tools/dev/e2e-env.mjs` + `tools/dev/e2e-server.mjs`, Playwright webServer) that resets only the
slot database, starts platform/auth(test mode)/sync on the `.polier-slot` ports, seeds two accounts,
a workspace and a board with fixed ids, serves the built app with same-origin `/v1` HTTP + WebSocket
proxies on the web-e2e port and tears its processes and rows down; gated test-mode session auth
(no Kratos in the gate; optional skipped manual Kratos spec); six spec files for session guard,
boards, note panel/editor, toolbar/zoom/L17 view, context menu/keyboard/undo and two-user realtime +
offline/reconnect, with web-first assertions, one worker, trace/screenshot on failure and no retries;
`docs/gates/playwright.md`, the real `e2e` row in `docs/quality.md` and README run notes.

In-scope integration fixes the browser suite exposed: the engine's contract-version assertion now
uses `kSupportedContractVersion = "0.4.0"` (clean wasm-build after the contract bump); the SDK
session probe accepts the platform's flat `{requestId, accountId}` envelope and the UI falls back to
a short account-id label; the board page renders the canvas while loading (it previously never left
the loading state because the load effect needed the canvas); the L04 panel uses border-box (exactly
400 px); remote note-title updates reach an open panel; new cards are selected once their content
projection exists; the browser offline/online events drive the SDK's new `goOffline`/`goOnline`
(half-open WebSocket, kept unacknowledged operations, flush on reconnect); and a sync session applies
other clients' broadcast `operationBatch` to its own server-side document, so a client that joined
before another client created a note can save that note's body.
