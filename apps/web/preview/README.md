# Design preview (P0-19, P0-20, P0-21, P0-22, P0-23, P0-24, P0-25, P1-07)

A design preview of the Project air design system. It is **not the product**: there is no engine,
no data, no server and no build step. It exists so the owner can see the look and feel between
milestones — the top section is a small live interaction demo, the rest is static token, component
and contract documentation.

## Version and last change

The masthead identifies which build the preview represents. The line is static in `index.html` with
stable `data-preview-*` hooks — no runtime parsing and no fetch — and its two values come from:

- **Version** — the first `##` heading of [`CHANGELOG.md`](../../../CHANGELOG.md), currently
  `0.0.1 – unreleased`; the status word comes from the same heading. `CHANGELOG.md` is the display
  source and currently agrees with the root `package.json` version `0.0.1`.
- **Last change** — the newest entry in `.changes/` by highest task id, currently
  `.changes/P1-07-contract-overview.md`; the line shows the task id and that task's title from
  `board.json` / the task brief: `P1-07 — Contract overview in the preview`. If several files exist
  for the highest task id, the most recent one is used; the `.changes/README.md` and
  `.changes/TEMPLATE.md` files do not count as entries.
- **Date and time** — the file modification time of that newest `.changes` entry (the moment the task
  wrote it), formatted as `YYYY-MM-DD HH:MM` in `Europe/Zurich`; it is static text in `index.html`
  (`data-preview-last-change-time`) and is not parsed at runtime.

Version, last change, date/time, the interactive demo and the screenshot in `reviews/evidence/` are
all updated in the same task as every change to the preview, the changelog or the design system (demo
cadence). A later changelog version or change entry must refresh the whole meta line in that same
task.

## What it shows

- A masthead meta line with the changelog version, the latest change entry and its date/time.
- A **contract 0.1.0 overview**: version, schema families and files, the 19 operation types, the
  6 + 6 sync message types, the seven error codes with their `errors.<camelCase>` message keys and
  the 77-fixture parity proof (32 valid, 45 invalid) with generated TypeScript and C++.
- An **interactive connection demo**: two note cards joined by one curved edge. Drag a card with
  mouse, pen or finger, or focus a card and use the arrow keys (16 px per step); `Home` resets both
  cards. Clearly labelled “interactive demo — not the engine; no data, no server”.
- A floating **zoom pill** in the demo (preview-only): zoom in, zoom out and fit stacked vertically,
  drawn with CSS shapes and labelled in English.
- Colour swatches with their token names (`--bg` … `--tone-e`), including the translucent tokens over
  `--card`.
- The typography scale (serif and sans, 28/24/22/15/13/12/11 px, weights, line height, type label).
- Spacing 4–48 px, the radii, both token shadows, the border and outline widths, and the sizes.
- The ten toolbar icons from `packages/ui-kit/icons/` at 20 px in a 36 px button and 16 px in a
  28 px card button.
- Component states: rest, hover, focus, pressed, selected and disabled, plus an active tool.
- One example each of a note card, block, zone, connection, side-panel header and toolbar
  arrangement.
- A sample board composition (zones, note cards, a block, a connection), clearly labelled as a
  static design preview.

All colour, spacing, radius, typography, motion, shadow and layer values are read as
`var(--…)` from the generated [`packages/ui-kit/tokens.css`](../../../packages/ui-kit/tokens.css); the
preview files contain no raw colour values and no new tokens. Icons are loaded from
[`packages/ui-kit/icons/`](../../../packages/ui-kit/icons/). There are no external fonts, no CDNs, no
images and no framework.

## The interactive demo

The demo is plain DOM and SVG in [`preview.js`](preview.js); it has no dependencies and never talks
to a server. It stays permanently at the top of the preview: every change to the preview or to the
design system updates the demo and refreshes its screenshot in `reviews/evidence/` in the same task.

- **Pointer drag:** the whole card is the handle. `pointerdown` selects the card and captures the
  pointer (`setPointerCapture`), `pointermove` moves it only after the 4 px drag threshold
  (`--drag-threshold`), `pointerup`/`pointercancel` end the drag. Movement under 4 px therefore
  selects without moving. While dragging the cursor is `grabbing` and the card uses the
  dragged/selected layer (`--layer-dragged-or-selected`); a selected card gets the 1.5 px `--accent`
  border and the `--accent-soft` ring.
- **Anchors (invisible geometry):** every card has four anchor positions — top, right, bottom and
  left side midpoints, 4 px inside the edge — but they are pure geometry: no DOM elements, no dots
  and no hover targets. The whole card stays the drag handle.
- **Edge:** one curved SVG path (cubic Bézier) between the centres of the nearest anchor pair (all
  4 × 4 distances are compared, the first minimal pair wins on a tie). Its control points sit on the
  two anchors' side normals at 48 px (`--space-48`), so the curve leaves and enters the cards
  perpendicularly; it recomputes on every pointer move, keyboard step, zoom and reset and is clamped
  to a minimum visible length of 1 px when the cards overlap. The path sits on the `--layer-edges`
  layer below the cards (`--layer-note-cards`) and keeps the design-system connection style — a
  `--tone-d` stroke at 1.5 px (`--border-width-strong`) with `--tone-d` endpoint dots.
- **Zoom pill (preview-only):** one floating vertical control sits 12 px from the bottom-left corner
  of the demo surface — a 44 px container with `--radius-md`, `--surface` background, a 1 px
  `--border` outline, 4 px padding and three stacked 36 px segments (zoom in, zoom out, fit) separated
  by 1 px `--border` rules. The `+`, `−` and fit-corner glyphs are drawn with CSS shapes only; every
  segment has an English `aria-label` plus a CSS tooltip (`Zoom in`, `Zoom out`, `Fit to view`) and
  follows the design states (hover `--faint`, pressed `scale(0.97)`, `--accent` focus outline,
  disabled at 0.4 opacity). Zoom scales a world layer between 50 % and 150 % in 10 % steps; segments
  are disabled at the limits, and fit returns to 100 % so both cards (clamped in world space) are
  visible again, also after dragging. Pointer deltas are divided by the scale so dragging stays under
  the cursor, and keyboard steps remain one canvas grid step (16 px) in world space. The product's
  zoom control will use the ui-kit icon set later; this one is a preview-only sketch.
- **Keyboard:** each card is focusable with a visible `--accent` focus outline. `ArrowLeft`,
  `ArrowRight`, `ArrowUp` and `ArrowDown` move the selected card by one canvas-grid step
  (`--canvas-grid`, 16 px); `Home` returns both cards to their start positions. Key presses that the
  demo handles call `preventDefault`, so the page does not scroll.
- **Bounds:** card positions are clamped to the dot-grid demo surface, so a card cannot leave the
  area or cause horizontal page overflow. On resize the cards are clamped again and the edge is
  redrawn.
- **Limits:** no snapping, no pan, no persistence, no add/remove, no multi-select, no engine; anchors
  are invisible geometry and zoom is only the preview control above. Card positions exist only in this page’s memory; reloading
  resets the demo. The dot grid is drawn from tokens (`--border`, `--canvas`, `--canvas-grid`).
  `prefers-reduced-motion: reduce` disables the remaining transitions.

## The contract overview

The **Contract 0.1.0 — the shared language** section (second section, after the demo) makes the
contract stage visible. It is static markup in `index.html` with stable `data-contract-*` hooks — no
fetch, no build step and no framework — so it also renders from `file://`. Every value matches
[`packages/contracts`](../../../packages/contracts/README.md) at merge time:

- **Version 0.1.0** — logical in this stage; the `contracts@0.1.0` tag is created by the owner/CI in
  the remote phase (ADR-0002, ADR-0003). The `$id` base
  `https://project-air.dev/contracts/0.1.0/` is a placeholder until the domain is decided (Q1).
- **Schema families and files** — `schemas/*.schema.json` (the board-content codegen input plus the
  root `board-content.schema.json`, corpus `fixtures/`), `schemas/sync/sync.schema.json` (corpus
  `fixtures-sync/`) and the five REST API schemas (corpus `fixtures-api/`). `fixtures-gate/` holds
  two direct specimens because the Polier `contracts` gate only reads `valid/*.json` and
  `invalid/*.json`; a unit test enforces the copies.
- **Operation types** — the 19 types under the AD-1 rule: one gesture is one operation with exactly
  one inverse, and `group` is ordered and never nested.
- **Sync message types** — 6 client to server and 6 server to client in one closed `oneOf` envelope;
  a durable `ack` covers every operation id of its batch (AD-2).
- **Error codes** — the seven fixed UPPER_SNAKE codes, each with the required `messageKey`
  `errors.<camelCase>`, so the user text comes from the translation files (AD-8).
- **Fixture proof** — the parity corpus has 77 fixtures (32 valid, 45 invalid); TypeScript
  (`test/parity/canonical.ts`) and C++ (`test/cpp/parity.cpp`, including `generated/contract.h`)
  reduce them to identical canonical lines. `codegen.mjs` generated the committed
  `generated/types.ts` and `generated/contract.h`; hand edits fail the `codegen` gate on a diff.
- **Links and cadence** — the section links to [docs/contracts.md](../../../docs/contracts.md) and
  [ADR-0005 — Contract and versions](../../../docs/adr/ADR-0005-contract.md), and it is refreshed in
  the same task as every contract or preview change (demo cadence); the live two-note demo above
  stays permanent.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The page, including the demo markup. |
| `preview.css` | Layout only; every visual value is a token. |
| `preview.js` | The dependency-free pointer and keyboard demo. |
| `README.md` | This file. |

## Serve locally

Serve the **repository root**, not this folder, so the relative token and icon paths resolve. Read
the slot's `web` port from `.polier-slot` (never hard-code it), then:

```sh
cd "/Users/rasulatashev/Desktop/KI Projekte/Project air-P1-07"
PORT=$(python3 -c "import json; print(json.load(open('.polier-slot'))['ports']['web'])")
python3 -m http.server "$PORT" --bind 127.0.0.1
```

Open `http://127.0.0.1:<port>/apps/web/preview/` in a browser. Check it with:

```sh
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PORT/apps/web/preview/"
```

Stop the server with `Ctrl+C` (or kill only the process you started). `python3 -m http.server` has
no dependencies and is the only server this preview needs.

## Screenshots

Committed evidence lives in `reviews/evidence/`: `P0-19-desktop.png` (1440×900),
`P0-19-mobile.png` (390×844), `P0-20-demo.png` (1440×900, both demo cards and their edge),
`P0-21-demo.png` (1440×900, the demo edge in the design-system `--tone-d` style),
`P0-22-demo.png` (1440×900, the masthead version and last-change line),
`P0-23-demo.png` (1440×900, the four anchors and the snapped edge),
`P0-24-demo.png` (1440×900, the curved edge, 8 px anchors and the zoom controls),
`P0-25-demo.png` (1440×900, the grouped zoom pill and dot-free cards),
`P1-07-desktop.png` (1440×900, top with the refreshed masthead and the demo),
`P1-07-mobile.png` (390×844, top with the refreshed masthead),
`P1-07-contract.png` (1440 wide, the contract overview section) and the
`P0-19-preview.log` / `P0-20-preview.log` / `P0-21-preview.log` / `P0-22-preview.log` /
`P0-23-preview.log` / `P0-24-preview.log` / `P0-25-preview.log` / `P1-07-preview.log` files with the
exact serve, curl and screenshot commands. The page has no horizontal overflow at 1440×900 or
390×844.
