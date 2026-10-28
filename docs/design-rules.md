# Design law — canvas and app

**As of:** 2026-10-25 · binding for every agent and person who touches UI or engine rendering
code · belongs to `docs/canvas-acceptance.md`

> This document is not a suggestion. **MUST** means must, **NEVER** means never. Whoever wants to
> deviate writes the question in `open_questions` and does not build. When in doubt: fewer
> elements, less colour, less motion.

## 0. Guiding idea in three sentences

1. **Content first, tool quiet.** The person's notes are the brightest thing on the screen; bars,
   frames and buttons recede.
2. **Calm instead of colourful.** Dark green-grey, one accent (`--accent`, sage), otherwise greys.
3. **Nothing jumps.** No element changes its position, size or text unless the person triggered it.

## 1. Working rules for the agent

- **MUST** read before the first line of code: `AGENTS.md`, `ARCHITECTURE.md`, this document,
  `docs/canvas-acceptance.md` (only its own entry and the cross-section) and the files listed
  under "Files" in its own entry.
- **MUST** implement exactly **one** entry of the acceptance catalogue per task. Nothing
  "improved on the side".
- **MUST** check every acceptance checkbox of the entry itself and tick it individually in the
  result (✓ / ✗ + one sentence).
- **MUST** store screenshots **before and after** at 1440×900 and 390×844 under
  `reviews/evidence/<ID>-before-*.png`, `…-after-*.png`.
- **MUST** work in the task's Polier worktree and take ports, database and bucket names only from
  `.polier-slot`.
- **MUST** run every gate of the task through
  `python3 $POLIER/tools/gate.py --task <ID> --name <gate> --shell "<command>"` and commit the
  records under `reviews/evidence/` with the task; a record with result `infra`, `busy` or
  `timeout` is not evidence.
- **MUST** leave lint, typecheck and unit checks green and run the e2e specs named in the entry
  (commands per package from P0-04, `docs/module-map.md`).
- **NEVER** a new dependency, **NEVER** change or delete existing tests, **NEVER** change files
  outside the entry's "Files" list. If another file is needed: ask.
- **NEVER** guess. Unclear = `open_questions`; do not report the entry as done.
- **NEVER** deliver "TODO", "later", placeholder text or commented-out code.

## 2. Colours

- **MUST** use only tokens from `packages/ui-kit/tokens.json`, generated as CSS custom properties
  and read as `var(--…)` in the web app and through the generated C++ header in the engine.
- **NEVER** new hex or `rgb()`/`rgba()` values in components or CSS modules. If a tone is missing:
  ask; new tokens only in `packages/ui-kit/tokens.json` and only with approval.

**Token source** — the future path appears here, not throughout the text:

| Values | Source of truth | Generated for the web app | Generated for the engine |
| --- | --- | --- | --- |
| colours, spacing, sizes, radii, typography, shadows, motion | `packages/ui-kit/tokens.json` | CSS custom properties, read as `var(--bg)` … | C++ header |

The custom-property names in this document are the token names; in `tokens.json` the key is the
same name without the leading `--`.

| Purpose | Token |
| --- | --- |
| Page background | `--bg` |
| Canvas surface | `--canvas` |
| Panels, bars, menus | `--surface` |
| Cards and blocks | `--card` |
| Main text | `--fg` |
| Secondary text, inactive icons | `--muted` |
| Dividers, resting borders | `--border` |
| Hover borders, input fields | `--border-strong` |
| Hover surface on icon buttons | `--faint` |
| Selection, focus, active tools | `--accent`, `--accent-soft`, `--accent-line` |
| Errors | `--danger` |
| Zone and palette tones, person colours | `--tone-a` … `--tone-e` (only zones, palettes, edges, person colours) |

- **Accent sparingly:** at most **one** filled accent button per screen (the main action). Accent
  otherwise only for selection, focus and snap lines.

## 3. Spacing, sizes, radii

- **4 px grid.** Allowed spacing: `4, 8, 12, 16, 24, 32, 48` px. **NEVER** 5, 7, 10, 13 …
- **Canvas grid 16 px** (snap, sizes, positions).
- **Click targets:** at least **32 × 32 px** (mouse), **44 × 44 px** at `pointer: coarse`.

| Element | Radius | Border | Shadow |
| --- | --- | --- | --- |
| Note card | `--radius-md` (14) | 1 px `--border-strong` | `--card-shadow` |
| Block / zone | `--radius-lg` (20) | 1 px `--border-strong` | `--card-shadow` |
| Icon button, input field, menu item | `--radius-sm` (10) | – / 1 px `--border-strong` | – |
| Bar, menu, tooltip | `--radius-md` / 6 px tooltip | 1 px `--border` | `--card-shadow` |
| Text button outside the canvas | `--radius-pill` | 1 px `--border-strong` | – |

- **NEVER** pill buttons **inside** cards or blocks. There: icon button or text link in `--muted`.
- **NEVER** shadows other than `--card-shadow` and `--shadow`.

## 4. Type

| Role | Family | Size | Weight | Colour |
| --- | --- | --- | --- | --- |
| Board title, panel title, empty state | `--font-serif` | 28 / 24 / 22 px | 400 | `--fg` |
| Card title, block title | `--font-sans` | 15 px | 600 | `--fg` |
| Body text in cards/blocks | `--font-sans` | 13 px, line height 1.4 | 400 | `--fg` |
| Type label (`NOTIZ`) | `--font-sans` | 11 px, uppercase, +0.1em | 600 | `--accent` |
| Status, hints | `--font-sans` | 12 px | 400 | `--muted` |
| Tooltip | `--font-sans` | 12 px | 500 | `--fg` |

- **NEVER** text below 11 px. **NEVER** more than two weights in one card.
- Long titles: one line, ellipsis (`text-overflow: ellipsis`), full title in the tooltip.
- **NEVER** clipped text without an ellipsis.

## 5. Icons

- **MUST** come from `packages/ui-kit/icons/` (own SVGs, 24 grid, stroke 1.6, `currentColor`,
  round caps). A new icon is a new entry there, same style. The web app and the engine texture
  atlas use the same SVGs.
- Icon **20 px** in a button of **36 px** (bar) or **16 px** in **28 px** (in cards).
- **NEVER** emoji, Unicode characters as icons (×, ✓, →) or icon libraries.
- Icon buttons **MUST** have `aria-label` (text from the translation files) and `data-label`
  (tooltip). **NEVER** the native `title` attribute as tooltip.

## 6. States — every interactive element has all of them

The states also apply to objects drawn by the engine.

| State | Appearance |
| --- | --- |
| Rest | as defined above |
| Hover | surface `--faint` or border `--border-strong`; icon `--muted` → `--fg` |
| Pressed | like hover, additionally `transform: scale(0.97)` |
| Focus (keyboard) | `outline: 2px solid var(--accent); outline-offset: 2px` – **NEVER** remove |
| Selected (card/block) | border 1.5 px `--accent`, outer ring `0 0 0 3px var(--accent-soft)` |
| Being dragged | shadow `--shadow`, cursor `grabbing`, opacity 1 (**NEVER** semi-transparent) |
| Disabled | opacity 0.4, cursor `default`, no hover |
| Done (checklist entry) | text `--muted` at opacity 0.6, clearly darker than open entries; tick in `--accent`; **NEVER** struck through |
| Saving | text "Speichert …" 12 px `--muted` in the status slot |
| Saved | "Gespeichert" 12 px `--muted`, fades to 0 after 2 s |
| Error | text 12 px `--danger`, stays, input is kept |

- Controls **inside** cards and blocks (delete, "add point", colour buttons) are **invisible** at
  rest (`opacity: 0`) and appear on hover, focus within or selection. They stay reachable by
  keyboard. On touch devices they are visible when selected.
- The status slot has a **fixed height** so that "Speichert …" moves nothing.

## 7. Motion

- Hover/colour: **120 ms ease**. Show/hide (tooltip, menu): **150 ms**. Panel: **180 ms ease-out**,
  only `transform` and `opacity`.
- Tooltip appears after **300 ms** of dwell, immediately on keyboard focus.
- **NEVER** bounce, springs, wobble, confetti, animated numbers.
- **NEVER** animate layout properties (`width`, `height`, `top`, `left`, `margin`).
- `@media (prefers-reduced-motion: reduce)`: all transitions at 0 ms.

## 8. Layers (z-order, bottom to top)

The same order is the render order of the engine and the z-order of the DOM.

| # | Layer |
| --- | --- |
| 1 | Canvas background (dot grid) |
| 2 | Edges (connections) |
| 3 | Zones |
| 4 | Blocks (checklist, palette, columns, timeline, table) |
| 5 | Note cards |
| 6 | Element just dragged or selected (temporarily at the top of its layer) |
| 7 | Snap guides, selection frame |
| 7a | Remote cursors (§12) |
| 8 | Canvas chrome: toolbar, zoom control |
| 9 | Side panel |
| 10 | Context menu, tooltip |
| 11 | Dialogs, toasts |

- Edges lie below every object, zones included: a connection line never crosses a zone's surface
  or title (owner decision 2026-10-28, ADR-0013).
- **NEVER** `z-index` > 10 in components without an entry in `packages/ui-kit/layers.ts`.

## 9. Canvas chrome — a fixed place for everything

| Element | Place | Distance to the edge |
| --- | --- | --- |
| Toolbar (icons) | top centre, floating | 12 px |
| Zoom control (+, −, show all) | bottom left, floating | 12 px |
| Save/error hint of the canvas | bottom centre, floating | 12 px |
| Side panel (note) | right, **overlaps** the canvas, 400 px wide | 12 px |

- **NEVER** more floating elements. **NEVER** rows of buttons above the canvas.
- "Show all" keeps at least **64 px** free at the top so the bar does not cover a card.
- The zoom control is **fully visible**.

## 10. Texts

- **MUST** come from translation files with English keys, German first. Du-Form. Short: button
  ≤ 2 words, tooltip ≤ 3 words, error message ≤ 1 sentence + what the person can do.
- **NEVER** exclamation marks, **NEVER** "Ups", **NEVER** technical terms (node, block ID,
  payload).
- Spelling and terms as in the German glossary (e.g. "Schliessen", "Notiz", "Zone"). **NEVER**
  two words for the same thing.
- German always uses `ss`; the sharp s is not allowed.

## 11. Acceptance of every UI entry (in addition to the entry's checkboxes)

- [ ] No colour values outside `packages/ui-kit/tokens.json`; the `design-check` gate rejects raw
      hex, `rgb()`, `rgba()` and `hsl()` values.
- [ ] All spacing from the 4-px series.
- [ ] All states from section 6 present and reachable by keyboard.
- [ ] No text clipped without an ellipsis; no text below 11 px.
- [ ] Nothing jumps on hover, save, open or close.
- [ ] At 390 px width nothing overflows horizontally and everything is operable.
- [ ] Before/after screenshots are under `reviews/evidence/`.

## 12. Realtime cursors and selection

- Other people's cursors are a **16 px** cursor with a **12 px** name label on a surface in the
  person's colour (`--tone-a` … `--tone-e`).
- After **5 s** without movement a remote cursor fades to opacity **0.4**.
- Another person's selection is a **1.5 px** frame in that person's colour, without a ring; the
  person's own selection follows section 6.

## 13. Engine

- No design numbers in C++ code outside the generated header (`tokens.h`). Radii, borders,
  shadows and thresholds — **4 px** dragging, **6 px** snapping, **16 px** grid, **40 px**
  header — are tokens.
- The engine reads every design value from `packages/ui-kit/tokens.json` through the generated
  header; it never carries its own copy.

## 14. Layout for translation

- Layout tolerates **+40 %** text length.
- Only logical CSS directions (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`, …).
- The engine shows no text of its own; object content is the only text it draws.

## Changes from the reference

- **Header:** the document belongs to `docs/canvas-acceptance.md`, the acceptance catalogue,
  instead of the reference's old work-order document.
- **§0:** the three guiding sentences are kept, but the reference's named product examples for
  "content first" are removed.
- **§1:** the workflow is Polier — task worktree, runtime slot from `.polier-slot`, gates through
  `gate.py` and records under `reviews/evidence/` — instead of the reference's old commands.
- **§1 reading list:** `docs/canvas-acceptance.md` (own entry and cross-section) replaces the
  reference's old work-order file.
- **§1 checks:** the reference's package-manager script names are replaced by the task's gates and
  the per-package commands that P0-04 defines in `docs/module-map.md`.
- **§2 token source:** values come from `packages/ui-kit/tokens.json`, generated to CSS custom
  properties and a C++ header, instead of a single global CSS file.
- **§2 table:** the future token path is stated once in the token-source table; the rest of the
  document keeps the reference's custom-property names.
- **§2 tone tokens:** `--tone-a` … `--tone-e` also cover person colours, which remote cursors and
  selections need (§12).
- **§4:** the reference's examples of clipped text from the older product are removed; the rule
  against clipped text is unchanged.
- **§5 icon source:** icons come from `packages/ui-kit/icons/` as SVGs shared by the web app and
  the engine texture atlas, instead of the reference's icon component.
- **§5 removed sentence:** the reference's sentence about the older product's "×" character is
  removed; the rule against character icons is unchanged.
- **§5 labels:** the `aria-label` text comes from the translation files instead of the reference's
  German strings file.
- **§6 scope:** the states also apply to objects drawn by the engine.
- **§8 scope:** the layer order is also the render order of the engine.
- **§8 layer 7a:** remote cursors are added as layer 7a; the reference's layers 1–11 keep their
  numbers and order.
- **§8 z-index:** a `z-index` above 10 requires an entry in `packages/ui-kit/layers.ts` instead of
  only an entry in this list.
- **§9 global action:** the reference's prototype-specific global action row is removed; the
  other §9 rules stay unchanged.
- **§9 defect note:** the reference's note about a clipped zoom control at a certain window height
  is removed; the rule that the control is fully visible stays.
- **§10 text source:** texts come from translation files with English keys and a German glossary
  instead of the reference's German strings file.
- **§10 spelling:** German examples use `ss` throughout (for example "Schliessen").
- **§11 acceptance:** colour checking uses `packages/ui-kit/tokens.json` and the `design-check`
  gate instead of the reference's grep exception for the old global CSS file.
- **§12, §13, §14:** realtime cursors and selection, the engine constraints and the i18n layout
  are new sections taken from blueprint section 21.1.
