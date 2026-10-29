area: web
kind: minor

Add the committed canvas evidence for the web-app stage (P6-11, D12): a Playwright capture suite
(`apps/web/e2e/canvas-evidence.capture.ts` + `apps/web/playwright.capture.config.mjs`) that reuses
`tools/dev/e2e-env.mjs` under the exclusive `e2e` lock, creates one deterministic board per entry,
waits for the engine-ready and `Saved` states and writes 1440×900 / 390×844 screenshots for L00,
L02, L04, L05, L06, L09, L12, L17, L18 plus the German L05 offline hint and the a11y keyboard-path
captures to `reviews/evidence/` (21 PNGs) with a capture record (entry, viewport, commit,
environment, spec step, measured checks). Mark L00/L04/L05/L06/L09/L12/L17 `fulfilled` in
`docs/canvas-acceptance.md` with the evidence paths; keep L02/L18 `open` with the exact remaining
web gap and cite the engine-core evidence (P4-10, P4-23, P4-28) for their engine part.

Evidence-pass integration fixes: the toolbar/zoom chrome was anchored to `.board-page` and floated
over the board header — it now lives inside `.board-canvas-wrap` (48 px bar, 12 px gap, `box-sizing`
kept from breaking the target); the context menu measured 210 px (content-box) and is now exactly
200 px so it stays inside the 390 px viewport; the panel's `opening` phase gets a 250 ms fallback so
a throttled animation frame can never leave it invisible; the top bar wraps at 390 px so the mobile
page no longer overflows horizontally. Docs: `docs/web-app.md` stage report
(numbers, architecture, the eleven integration defects, D12 exit status, a11y/touch basics, value and
hardening handoff), `docs/contracts.md` title/lede to 0.4.0, and the browser-session/presence/L05
paragraph in `docs/realtime.md`. Repo-wide `design-check` and `language-check` (playground/demo
texts included) pass, plus `board-check`, `boundaries`, `unit` and `e2e` (12 passed / 1 skipped
manual) records.
