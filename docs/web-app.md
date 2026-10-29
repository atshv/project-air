# Web-app stage report and canvas evidence (P6-11)

**As of:** 2026-10-29 · **Stage:** web-app · **Task:** P6-11 · **Gates:** `e2e`, `design-check`,
`language-check`, `board-check`, `boundaries`, `unit`

This report closes the web-app stage: it records what the stage proved with numbers, the canvas
evidence for the remaining web entries, the integration defects the browser suite and the evidence
pass found, the D12 exit-criteria status and the explicit handoff to **value** and **hardening**. The
product UI was built in P6-01 … P6-11 (React + Vite SPA on the SDK/engine/sync, ADR-0013); P6-10
delivered the Playwright suite and P6-11 the committed canvas evidence, the repo-wide check pass and
this report. Every number below is reproduced by the committed gate commands and records under
`reviews/evidence/`.

## What is proven (numbers)

| Item | Result | Record |
| --- | --- | --- |
| `e2e` (exclusive, slot 3, Chromium 156) | **12 passed, 1 skipped** (the manual Kratos spec), 13 tests in 6 spec files | `reviews/evidence/P6-11-e2e-20261029T021404Z.json` |
| Canvas capture suite (same environment, exclusive lock) | **10 passed**, 9 canvas entries + the a11y pass, **21 screenshots** at 1440×900 and 390×844 | `reviews/evidence/P6-11-canvas-capture-20261029T021458Z.json` |
| `unit` (`pnpm test --affected`) | **53/53** web tests pass (the task touches `apps/web`); SDK/engine/auth suites unchanged from their stage records | `reviews/evidence/P6-11-unit-20261029T021702Z.json` |
| `boundaries` | **0 findings** | `reviews/evidence/P6-11-boundaries-20261029T021702Z.json` |
| `design-check` | **0 findings** repo-wide | `reviews/evidence/` (P6-11 record) |
| `language-check` | **0 findings** repo-wide | `reviews/evidence/` (P6-11 record) |
| Web bundle (built `apps/web/dist`) | JS **455,197 B** raw / **138,397 B** gzip; CSS **13,896 B** / **3,259 B** gzip | P6-11 build (this report) |
| Engine artifacts (gitignored build) | `engine.wasm` **160,174 B**; `engine.js` **48,853 B**; served at `/build-wasm/` | `bash packages/engine/tools/build-wasm.sh` |
| Commit of the capture/gate records | `00ea22b` (the P6-11 base); the evidence is committed with the task commit | capture record `environment.commit` |

The product is a single-page app on the same origin as the platform API. The canvas is the engine's
WebGL2 WebAssembly renderer, the note panel is DOM, and the e2e environment starts the built app with
the slot's auth (gated test mode), platform and sync services on the `.polier-slot` ports. No paid
tier, no hosted service and no new dependency beyond the pinned devDependency `@playwright/test`
1.64.1 (Apache-2.0) took part.

## Canvas entry evidence table

The catalogue is [docs/canvas-acceptance.md](canvas-acceptance.md); the screenshots and measured
checks are in `reviews/evidence/P6-11-canvas-capture-20261029T021458Z.json`. Engine-owned parts cite the engine-core evidence
(`P4-10`, `P4-23`, `P4-28`) instead of duplicating the claim.

| Entry | Stage(s) | Status | Evidence | Remaining gap |
| --- | --- | --- | --- | --- |
| **L00** toolbar | web-app | **fulfilled** (P6-11) | `P6-11-L00-desktop.png`, `-mobile`; 48 px bar 12 px inside the canvas, 36 px buttons, 300 ms tooltip, all six buttons reached by `Tab` | — |
| **L02** visible quality | engine-core, web-app | **open** | engine: `P4-10-capture-before/after-*.json`, `P4-28-visual-final-*.json`; app: `P6-11-L02-desktop.png`, `-mobile` | the app projects rectangles only, so card titles/previews and the column/timeline/delete-button checks are not visible in the product canvas yet |
| **L04** panel without jump | web-app | **fulfilled** (P6-11) | `P6-11-L04-desktop.png`, `-mobile`; panel 400 px with 12 px top/right/bottom gaps, canvas width unchanged, full canvas width at 390 px, `Esc` closes | — |
| **L05** saving with status | realtime, web-app | **fulfilled** (P6-11) | `P6-11-L05-desktop.png`, `-mobile`, `P6-11-L05-offline-de-desktop.png`; **418 ms** last-key-to-`Saved`, reload keeps value and cursor, offline German hint kept + reconnect converged; unit sequence guard | — |
| **L06** empty note | web-app | **fulfilled** (P6-11) | `P6-11-L06-desktop.png`, `-mobile`; placeholder "Start writing …", editor focused, no placeholder stored | — |
| **L09** title in the panel | web-app | **fulfilled** (P6-11) | `P6-11-L09-desktop.png`, `-mobile`; title edit, `Enter` into the editor, reload persistence | — |
| **L12** keyboard and context menu | engine-core, web-app | **fulfilled** (P6-11) | `P6-11-L12-desktop.png`, `-mobile`; menu **200 px**, five entries, reachable/activatable with `Tab`+`Enter` inside 390 px | — |
| **L17** remember view | engine-core, web-app | **fulfilled** (P6-11) | `P6-11-L17-desktop.png`, `-mobile`; zoomed view (1.21) restored after reload at both viewports, new board fitted | — |
| **L18** inline comfort | engine-core, web-app | **open** | engine: `P4-23-inline-*.json` (24/24 browser checks: `Enter`/`Tab`/`Shift+Tab`/empty `Backspace`, 24 px colour field); app: `P6-11-L18-desktop.png`, `-mobile` | checklist/column/table blocks are not creatable in `apps/web` yet, so the checklist acceptance stays engine-side |

Engine-only entries (L03, L07, L10, L11, L13, L14, L16, L19, L20) and the engine/hardening parts of
L01 and L15 remain `open` in the catalogue: their engine proof exists (stage-5 report), but the
lead's status pass has not moved them and the web app does not exercise them yet. The stage exit
criterion is therefore **met for the web-app entries** and explicitly **not claimed** for the
engine-only catalogue entries.

## A11y and touch basics

The capture suite drives a real keyboard path and records the measured targets
(`reviews/evidence/P6-11-canvas-capture-20261029T021458Z.json`, `a11y` block); screenshots:
`P6-11-a11y-login-desktop.png`, `P6-11-a11y-board-focus-desktop.png`.

**Keyboard-only path.** 6 × `Tab` from the document reaches the e-mail field (`Project air` link,
`Boards`, `Settings`, `DE`, `EN` are the preceding stops); the form is filled with the keyboard and
submitted with the `Sign in` button. On `/boards` the board link is reached with `Tab` and opened
with `Enter`; on the board the toolbar and view controls are reachable with `Tab`, and the note panel
is then operated with the keyboard (title field, editor, `Enter` to move into the editor, `Esc` to
close, autosave produces `Saved`). **Gap:** creating or selecting a canvas object still needs a
pointer — there is no keyboard object navigation/focus mirror on the canvas. This is the a11y/test
mirror (Q20) and stays in hardening.

**Roles, names, states.** `navigation "Main navigation"`, `toolbar "Tools"`, `group "View controls"`,
the labelled canvas (`Board canvas`), the note panel (`complementary "Note"`), the status region
(`status`), the language group and all form labels resolve to exactly one element each. Every
interactive state uses tokens. Two findings are recorded for hardening: the two toolbar tools
`Select`/`Pan` share the accessible name "Select", and the browser default focus ring is visible
(`auto 1px`) but is not yet replaced by the design-rule §6 token outline (2 px `--accent`,
offset 2 px). Neither removes keyboard focus.

**Tap targets (desktop and 390 px identical; tokens `button-bar` 36 px, `button-card` 28 px).**
Toolbar buttons 36 × 36 px, zoom buttons 36 px high (86–96 px wide), panel close 58 × 28 px. The
390 px viewport has no horizontal page overflow after the top-bar wrap fix. Nothing
is below the 28 px card target; the 44 px coarse-pointer target (`click-target-coarse`) is not
applied yet and belongs to the touch work.

**Contrast from tokens** (`packages/ui-kit/tokens.json`, composited): foreground on background
**15.69:1**, muted on surface **8.01:1**, accent on surface **8.29:1**, danger on surface **8.76:1**
— all above WCAG AA. Touch gestures (L15) stay in hardening: no touch gesture is claimed here.

## Architecture summary

- **React 19 + Vite 8 SPA** in `apps/web/src` (routes `/login`, `/register`, `/recovery`, `/boards`,
  `/boards/:id`, `/settings`; ADR-0013) on packages only: `packages/engine` (WebGL2 WASM canvas),
  `packages/sdk` (platform API client + board-sync client), `packages/editor` (own editor),
  `packages/ui-kit` (tokens, icons, layers) and `packages/contracts` (generated types).
- **SDK-owned CRDT document** (ADR-0012): `createBoardSyncClient` holds the `BoardDoc` (Yjs MIT
  behind the CRDT interface, ADR-0011), speaks contract 0.4.0, applies remote batches and acks, and
  owns the offline queue + the one autosave path (`createAutosave`, 400 ms debounce, flush triggers,
  sequence numbers). The app only projects the resulting content to the engine and renders the
  panel; it never writes a second save path.
- **Cookie session handshake:** the same-origin session cookie rides the WebSocket upgrade; the
  contract hello `tokenRef` is the opaque reference (no token in JavaScript). Server-side auth is
  unchanged; the gated test-mode session is used only by the e2e harness.
- **Own editor** (no editor dependency) inside the L04 400 px overlay, with the L06 focus/placeholder
  and L09 title behaviour; note bodies are contract 0.4.0 structured-JSON documents.
- **One renderer, engine-owned chrome:** toolbar/zoom/menu are DOM, the canvas is the engine; the
  L04 pan is the only transient camera change and it is never persisted (L17 stores user input only).
- **No paid-tier dependency:** MIT/Apache/BSD/ISC only; `@playwright/test` 1.64.1 is the only e2e
  dependency and is pinned in `docs/versions.md`.

## Integration defects found and fixed

P6-10's browser suite found eight integration bugs; the P6-11 evidence/check pass found four more.
All are fixed in the merged tree and covered by the gates.

**P6-10 (e2e):** (1) the engine's contract-version assertion still expected 0.3.0 — now
`kSupportedContractVersion = "0.4.0"` with a clean WASM build after the contract bump; (2) the SDK
session probe rejected the platform's flat `{requestId, accountId}` envelope — now accepted with a
short account-id label fallback; (3) the board page could never leave the loading state because the
load effect needed the canvas — canvas renders while loading; (4) the L04 panel was not exactly
400 px — border-box; (5) a remote note-title update did not reach an open panel — external title
update applied unless the field is locally dirty; (6) a newly created card was selected before its
content projection existed — pending selection; (7) a dropped browser connection kept a half-open
WebSocket and silently dropped frames — browser `offline`/`online` drive the SDK's `goOffline`/
`goOnline` with an ordered queue flushed on reconnect; (8) a sync session did not apply another
client's broadcast `operationBatch` to its own server-side document — a client that joined before
another client created a note could not save that note's body.

**P6-11 (evidence pass):** (9) the toolbar and zoom controls were anchored to `.board-page`, so the
bar floated over the board header instead of 12 px inside the canvas — the chrome now lives inside
`.board-canvas-wrap` (48 px bar, 12 px gaps); (10) the context menu measured 210 px because its
200 px target ignored padding/border — border-box, so it is exactly 200 px and stays inside the
390 px viewport; (11) the panel's `opening` phase could stay invisible if the animation frame was
throttled — a 250 ms fallback after the frame guarantees the transition; (12) the top bar did not
wrap, so the page overflowed horizontally at 390 px — the bar and its actions now wrap, keeping the
mobile viewport overflow-free (design rule §11). The panel stall also explains one non-reproducible
panel-open observation in an early P6-11 gate attempt (the product suite and the reruns passed; the
suite still has `retries: 0`).

## Exit-criteria status (D12)

D12: the product runs in `apps/web` on the SDK, engine and sync — login and boards list over the
platform API, the board page with engine, toolbar/zoom, context menu/keyboard, panel with the own
editor and title, live remote changes/presence and the L05 save status; the main e2e flows are green,
every remaining canvas work order of the web phase has evidence, and design-check plus
language-check are green repo-wide.

| Criterion | Status | Note |
| --- | --- | --- |
| Product flows (login, boards, board, panel/editor, realtime/presence, L05) | **done** | 12 e2e tests; manual Kratos login is the skipped spec |
| Canvas work orders with evidence (web phase) | **7 of 9 fulfilled** | L00, L04, L05, L06, L09, L12, L17; L02/L18 open with the exact gap above; engine-only entries wait for the lead's status pass |
| `design-check` repo-wide | **green** | P6-11 record under `reviews/evidence/` |
| `language-check` repo-wide | **green** | includes the playground/demo texts |
| A11y/touch basics | **documented, gaps recorded** | keyboard path + audit above; canvas-object focus, duplicate "Select" name and token focus ring stay in hardening (Q20) |

## Open points and handoff

**Handoff to value (stage 8, D13).** Templates/library/search, import/export (Q8 formats after the
legal check), the AI coach (server-side only, ADR-0006) and sharing/comments: the web app has the
routes, session, panel and editor they build on. The note body is already contract 0.4.0 structured
JSON with `plainText` for search, so search does not need a second body format. Existing gaps the
value stage must know: the platform board-content bootstrap is not wired (fresh boards start from
the empty baseline), member/invitation routes are not in the UI yet, and the canvas does not render
note titles/previews (needed for search hit highlighting on cards).

**Handoff to hardening (stage 9).**

- **M1 reference-hardware measurement** (L01) — the Mac mini M2 proxy is accepted; the MacBook Air
  M1 8 GB target is still unmeasured.
- **Images and detail levels (Q20)** — media service, thumbnails, engine image rendering.
- **Touch (L15)** — trackpad/touch gestures are not claimed; only desktop and a narrow viewport were
  evidenced. Coarse-pointer 44 px targets are not applied.
- **A11y/test mirror (Q20)** — keyboard object navigation/focus on the canvas, the duplicate
  `Select`/`Pan` accessible name, the token focus ring, and a screen-reader mirror for engine chrome.
- **Performance budget for the SPA** — the bundle numbers above are recorded, but no budget gate
  runs for `apps/web` yet (the engine `perf` gate is unrelated to the JS startup cost).
- **Real Kratos in CI** — the automated gate uses gated test-mode sessions; the real login stays a
  manual spec (`E2E_KRATOS=1`).
- **Sync compaction scheduler and RLS** — compaction is manual and the sync tables have no RLS
  (service authorizer only); board-content bootstrap remains open.
- **Pre-existing lint in `apps/web`** — `pnpm lint` reports pre-existing findings in the app; they
  are not introduced by this stage's tasks and need a separate cleanup pass (the `lint` gate is not
  part of this stage's exit criteria).
- **Test determinism** — the e2e suite has `retries: 0` and one observed non-reproducible panel-open
  stall; watch it in the remote CI and keep the panel phase deterministic (the 250 ms fallback is in
  place).

## Stage handoff

The web app is handed over as the first real product surface: a calm SPA on the engine and the SDK,
with cookie-authenticated realtime, an own editor, the one autosave path with honest status, and a
browser suite plus committed canvas evidence for every web-app entry. The stage exit criteria that
this task owns are green: `e2e` 12 passed / 1 skipped (manual), the web-app canvas entries fulfilled
with screenshots and measured checks, `design-check` and `language-check` green repo-wide. The
catalogue keeps L02/L18 and the engine-only entries open with their exact gaps; the lead's status
pass decides those. Next stage: **value**, then **hardening**, then the remote phase.
