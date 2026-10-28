# Canvas acceptance catalogue

**As of:** 2026-10-25 · **Owner:** lead · binding for every canvas and engine task

This catalogue holds one entry per canvas work order: `L00`–`L20`. It is the list behind the design
law, [docs/design-rules.md](design-rules.md), and it is what the `engine-core` and `web-app` stage
gates are checked against. A UI task without a matching entry is not ready.

Read with: [ARCHITECTURE.md](../ARCHITECTURE.md) (AD-1, AD-2, AD-7, AD-8),
[docs/module-map.md](module-map.md) (package paths), [docs/quality.md](quality.md) (gates, review,
definition of done), [board.json](../board.json) (stages, packages, open questions).

The entries were written from the blueprint's compressed table plus the detailed reference work
orders. The table is the summary, the reference carries the detailed numbers; both are kept. A value
that only the reference carries is marked `[reference Cx]`; a value that only the blueprint carries is
unmarked. Differences between the sources are in **Open points**.

All 21 entries start with status `open`; no entry is `fulfilled` in this task.

## How to use

- **One entry per task.** Design rule §1: exactly one entry per task, nothing "improved on the side".
  An agent reads `AGENTS.md`, `ARCHITECTURE.md`, `docs/design-rules.md`, its own entry and the
  cross-section, and only the files named in its task brief.
- **How a task cites an entry.** Task brief, commits and review start with the entry id and the
  reference work-order id, for example `L07 (C1)`; the task's acceptance list quotes the entry's
  **Acceptance** checks; the result ticks each check individually with ✓ / ✗ and one sentence.
- **Evidence.** Gates named here exist in [docs/quality.md](quality.md): `cpp-unit`, `e2e`, `perf`,
  `visual`, `design-check`, `language-check`, `api-tests`. Every acceptance check marked e2e gets its
  own new test file under `tests/e2e/`; existing test files are never changed. UI entries store
  before/after screenshots at 1440×900 and 390×844 under `reviews/evidence/`; performance and manual
  checks store their records there too. Every gate runs through
  `python3 $POLIER/tools/gate.py --task <ID> --name <gate> --shell "<command>"`; records with result
  `infra`, `busy` or `timeout` are not evidence.
- **Baseline checks for every entry.** `design-check` for every entry that changes UI or rendering
  code, `language-check` for every entry that adds or changes user-visible text. They are not repeated
  in every **Evidence** field below.
- **Status values.** `open` = initial, no accepted evidence. `fulfilled` = every acceptance check
  passed, evidence paths recorded, independent review passed. `deviated + owner approval` = a target
  value or rule is deliberately changed; the entry then names the deviation, the approved value and
  the owner approval reference — otherwise a deviation is not allowed. Only the lead changes a
  status, after review, together with the evidence path; a task never marks itself `fulfilled`.
- **Stage gates.** The `engine-core` gate (blueprint phase 4) and the `web-app` gate (blueprint
  phase 6) are green only when every entry carrying that stage is `fulfilled` with an evidence path
  (blueprint 21.2 gate rule).
- **Unclear means open question.** A missing or ambiguous value goes into `open_questions`, not into
  code; the entry stays `open` (design rule §1).
- **Text.** German strings quoted below are examples from the sources; the real UI text comes only
  from translation files with English keys (AD-8), German first, always `ss`, never the sharp s. This
  document is English.

## Stage mapping

Blueprint phase numbers map to board stage ids. Blueprint task ids such as `P4-02` do not exist on the
board; they appear only in brackets as notes in the **Stage** field. The mapping is blueprint phase N →
board stage N+1, consistent with the five mappings named in the task brief (phase 2 → `engine-spike`,
4 → `engine-core`, 5 → `realtime`, 6 → `web-app`, 8 → `hardening`); phases 1 and 3 also occur in 21.2
and map to `contract` and `backend-core`.

| Blueprint phase | Board stage id | Board stage | Entries |
| --- | --- | --- | --- |
| 1 | `contract` | 2 | L08, L10, L11, L13, L14 |
| 2 | `engine-spike` | 3 | L01 |
| 3 | `backend-core` | 4 | L08 |
| 4 | `engine-core` | 5 | L01–L03, L07, L08, L10–L14, L16–L20 |
| 5 | `realtime` | 6 | L01, L05, L11 |
| 6 | `web-app` | 7 | L00, L02, L04–L06, L09, L12, L17, L18 |
| 8 | `hardening` | 9 | L01, L15 |

## Cross-section rules (Querschnitt) — apply to every entry

1. **One gesture = one write operation.** Drag, group drag, resize, an arrow-key series, delete and
   undo are each exactly one operation from `packages/contracts` with its inverse (AD-1); the server
   stays the source of truth and the engine holds the working copy (AD-2).
2. **Build reversibility from the first write.** Every gesture is built as `{do, undo}`; the undo
   stack of L11 is only a stack over these operations — never a second write path, never a second
   save path.
3. **One autosave path.** L05 defines the only autosave behaviour: save 400 ms after the last
   keystroke, immediate flush on blur, panel close, navigation, tab hidden and page hide, sequence
   numbers so that an older response never overwrites a newer value. L09, L18 and every inline field
   use it; a second autosave is a defect.
4. **Tokens only.** Visual values come only from `packages/ui-kit/tokens.json` (AD-7); no raw hex,
   `rgb()`, `rgba()` or `hsl()`; spacing from the 4 px series (4, 8, 12, 16, 24, 32, 48); canvas grid
   16 px; drag threshold 4 px; snap tolerance 6 px; header 40 px (design rule §13). `design-check`
   rejects violations.
5. **Translation only.** User-visible text comes only from translation files with English keys
   (AD-8), German first, always `ss`; `language-check` rejects violations.
6. **All states, keyboard first.** Every interactive element has the design-rule §6 states (rest,
   hover, pressed, focus, selected, being dragged, disabled) plus the states named in the entry.
   Keyboard focus outlines are never removed; every control is reachable by keyboard.
7. **Nothing jumps.** No element changes position, size or text unless the person triggered it
   (design rule §0). Show/hide uses only `transform` and `opacity`: 180 ms panel, 120 ms hover
   colour, 150 ms tooltip/menu, tooltip after 300 ms dwell (design rule §7).
8. **No legacy migration.** Stored coordinates are not migrated; they snap to the 16 px grid on the
   next move.
9. **Prefer existing operations and components.** Use existing engine and contract operations plus
   design-system components instead of ad-hoc drag, zoom, selection, resize or autosave logic. When
   the engine spike decides the canvas technology, its built-in primitives are preferred over new own
   logic. The reference's library-specific wording could not be carried over (see Open points 8).
10. **One change entry per work order.** Implementation carries a change entry from P0-14; the
    reference's per-point changelog command is earlier-prototype process and is not carried over.
11. **Tests, commit, review.** Each entry is its own task with its own commit and an independent
    review per [docs/quality.md](quality.md); the reviewer checks every acceptance box and design
    rule §11.
12. **No approval-free changes.** No new dependency and no changed or deleted existing test without
    approval (`AGENTS.md`, design rule §1).

## L00 — Toolbar

*Reference work orders: C0, C19 (toolbar item).*

- **Goal:** Every canvas tool sits in one quiet icon bar inside the canvas, and no row of buttons
  sits outside it.
- **Target values:** icon bar floats at the top centre of the canvas, 12 px from the edge (design
  rule §9); bar height 48 px and bar background `--surface` (reference C19 item 8; the 64 px fit
  padding under L02 is bar 48 px + 16 px); buttons 36 px, icons 20 px; groups separated by a divider;
  the primary action is the only accent; tooltip after 300 ms dwell, immediately on keyboard focus;
  spacing only 4 px or 8 px `[reference C19 item 8]`.
- **States:** rest, hover, pressed, focus, active tool, tooltip visible, disabled tool.
- **Do not:** no row of buttons above the canvas (design rule §9); no raw colour values or
  `rgba()`/`hsl()`; no spacing off the 4 px series; no second accent button; do not invent a missing
  token — write an open question instead (reference C19 item 8).
- **Acceptance:** every tool reachable by mouse and keyboard; tooltip appears after 300 ms and
  disappears on leave or focus loss; no button row outside the canvas; bar uses only tokens and 4/8 px
  spacing; all design rule §11 checks pass at 1440×900 and 390×844.
- **Package:** `apps/web`.
- **Stage:** `web-app` (blueprint phase 6; P6-02).
- **Evidence:** `e2e`, `design-check`; before/after screenshots under `reviews/evidence/`.
- **Status:** `open`.

## L01 — Performance basis and proof

*Reference work orders: C13a, C13b.*

- **Goal:** From now on it is measurable whether a work order makes the canvas slower, and at the end
  performance is proved against the basis.
- **Target values:** basis measured in blueprint phase 2 (`engine-spike`), then after every engine
  phase; 10,000 objects at 60 fps; no long task > 16 ms while panning or zooming (blueprint). Every
  measurement ≤ basis + 10 % (blueprint). The basis run records long tasks, maximum duration and FPS
  while zooming/panning with 500 cards and 50 zones, stores the result as a JSON baseline under
  `reviews/evidence/` and quotes the core numbers in the task result `[reference C13a]`. Final proof
  after C1, C2, C3 and again at the end: 500 cards + 50 zones without a long task > 50 ms while
  zooming and panning, compared with the basis `[reference C13b]`; verify that off-screen content is
  not rendered `[reference C13b]`. Each measurement carries its date and evidence path; the
  blueprint's measured values are entered in this entry once a run exists.
- **States:** measurement runs only — basis, rerun after an engine phase, final proof; the `perf` gate
  is exclusive ([docs/quality.md](quality.md)).
- **Do not:** no code change during the basis measurement; no adjusted budgets; no dropped or rounded
  numbers; never run `perf` concurrently with another exclusive gate.
- **Acceptance:** basis record and final record exist under `reviews/evidence/` with date, numbers
  and paths; every run within basis + 10 %; 10,000 objects at 60 fps; no long task > 16 ms while
  panning/zooming; final proof 500 cards + 50 zones under 50 ms; comparison against the basis
  documented.
- **Package:** `packages/engine`.
- **Stage:** `engine-spike`, `engine-core`, `realtime`, `hardening` (blueprint phases 2, 4, 5, 8;
  P2-03, P4, P5-06, P8).
- **Evidence:** `perf`; baseline and final JSON records under `reviews/evidence/`.
- **Status:** `open`.

## L02 — Visible quality

*Reference work order: C19.*

- **Goal:** Nothing on the canvas looks cut off, doubled or random.
- **Target values:** card title single-line with ellipsis, 15 px/600; header 40 px; delete button
  28 px with a 16 px icon, invisible at rest; no inner scrollbars in blocks — blocks grow in height;
  columns at least 176 px wide and entries wrap; the content of a zone starts below its header; "show
  all" keeps at least 64 px free at the top (blueprint; plus reference C19). Reference C19 detail:
  zone label removed or moved into the header; delete button `opacity: 0` at rest, visible on hover,
  focus within and selection; column entries wrap with `overflow-wrap: anywhere`, no inner horizontal
  scrollbar; timeline inner padding 16 px, phase gap 12 px, no inner scrollbar, block grows; zoom
  control fully visible with a 12 px margin; `fit` padding so that ≥ 64 px stay free at the top (bar
  48 px + 16 px); zone content inner padding top 40 px + 16 px.
- **States:** rest, hover, focus, selected for the delete button and the header.
- **Do not:** no changed block sizes in the database; no new colours; no deletion by keyboard only —
  the button stays, it only becomes quiet; never a character as an icon, in particular no "×"
  (design rule §5).
- **Acceptance:** the eight visible defects are each evidenced with a before/after screenshot; no "×"
  character left in canvas code; `Tab` reaches every delete button and makes it visible (e2e); no
  inner scrollbar in columns or timeline on the sample board (e2e); design rule §11 checks pass.
- **Package:** `packages/engine`, `apps/web`.
- **Stage:** `engine-core`, `web-app` (blueprint phases 4 and 6; P4-02, P4-03, P6-02).
- **Evidence:** `visual`, `e2e`; before/after screenshots for the eight defects under
  `reviews/evidence/`.
- **Status:** `open`.

## L03 — Dragging vs editing

*Reference work order: C14.*

- **Goal:** Clicking opens, dragging on the grip moves, clicking in text edits — never two of them at
  the same time.
- **Target values:** drag threshold 4 px; note cards — the whole card is the grip; blocks and zones —
  only the 40 px header is the grip, cursor `grab`/`grabbing`; elsewhere cursor `default`, on fields
  `text`; every `input`, `textarea`, `select`, `button` and editable area inside a block does not start
  a drag, and scrollable areas keep their own wheel handling; header hover surface `--faint` for
  120 ms; a click without movement beyond the 4 px threshold writes no position (blueprint; reference
  C14).
- **States:** rest, header hover, being dragged, focus in a field.
- **Do not:** no own pointer handling next to the engine's; no grip icon in addition to the header; no
  double-click-to-edit mode.
- **Acceptance:** marking text in a checklist with the mouse moves the block (e2e); dragging the
  header moves it (e2e); a click without movement > 4 px writes no position (e2e: no move request);
  dragging inside a block body outside the header moves nothing.
- **Package:** `packages/engine`.
- **Stage:** `engine-core` (blueprint phase 4; P4-04, P4-08).
- **Evidence:** `cpp-unit`, `e2e`.
- **Status:** `open`.

## L04 — Panel without jump

*Reference work order: C8.*

- **Goal:** Opening a note leaves everything on the canvas where it was.
- **Target values:** panel absolutely positioned over the canvas on the right, 400 px wide (full
  width at a 390 px viewport), 12 px gap top/right/bottom, background `--surface`, border `--border`,
  shadow `--shadow`; show/hide with `translateX(16px)` + opacity, 180 ms ease-out; canvas width never
  changes; if the selected card lies under the panel after opening, the view shifts smoothly (300 ms)
  only so far that the card stands 24 px left of the panel — otherwise the view does not change
  (blueprint; reference C8).
- **States:** closed, opening, open, closing.
- **Do not:** no refit of the canvas on open or close; no modal with a dimmed background.
- **Acceptance:** screen position of a visible card that is not under the panel changes 0 px on
  opening (e2e: bounding box before/after); closing changes nothing (e2e); `Esc` closes the panel.
- **Package:** `apps/web`.
- **Stage:** `web-app` (blueprint phase 6; P6-03).
- **Evidence:** `e2e`; before/after screenshots and the bounding-box record under
  `reviews/evidence/`.
- **Status:** `open`.

## L05 — Saving with status

*Reference work order: C3.*

- **Goal:** It is always visible whether what was typed is saved, and nothing is lost.
- **Target values:** status "Speichert …" → "Gespeichert" (2 s) → "Nicht gespeichert – erneut
  versuchen" (clickable); "Gespeichert" means server confirmation; offline changes wait in a queue;
  nothing is lost on closing or navigating; focus and cursor stay (blueprint). Save 400 ms after the
  last keystroke, immediately on blur, panel close, navigation, tab hidden and page hide; every request
  carries a sequence number, an older response never overwrites a newer local value; status per block
  in the header on the right (fixed slot, 12 px, `--muted`), error in `--danger`, stays, input is kept
  `[reference C3]`. Blueprint acceptance bound: saved ≤ 500 ms.
- **States:** rest, typing, saving, saved, error.
- **Do not:** no save on every keystroke; no spinner; no toast per save; no status indication that
  shifts the layout.
- **Acceptance:** typing without a focus change is saved in ≤ 500 ms and a reload shows the value
  (e2e); typing and immediately navigating away loses nothing (e2e); a delayed first response does
  not overwrite the second input (unit-level test of the hook, record under `reviews/evidence/`); an
  error (network off) shows a German hint and keeps the input (e2e with request interception); the
  cursor stays where it was.
- **Package:** `apps/web`, `packages/sdk`, `services/sync`.
- **Stage:** `realtime`, `web-app` (blueprint phases 5 and 6; P5-03, P6-04).
- **Evidence:** `e2e`, `api-tests`; network-error and unit records under `reviews/evidence/`.
- **Status:** `open`.

## L06 — Empty note

*Reference work order: C5.*

- **Goal:** A new note invites writing immediately.
- **Target values:** on opening an empty note the editor has focus and the cursor sits at the start;
  placeholder "Schreib los …" in `--muted`, 15 px, disappears at the first character; the placeholder
  is never saved (blueprint; reference C5). The solution adds no dependency; if the editor cannot do
  it reliably, write an open question `[reference C5]`.
- **States:** empty, first character, non-empty, reload.
- **Do not:** no placeholder as real content; never force focus in a non-empty note.
- **Acceptance:** a new note shows the placeholder and has focus (e2e); the first character hides it
  (e2e); a reload of an empty note stores no placeholder text.
- **Package:** `packages/editor`.
- **Stage:** `web-app` (blueprint phase 6; P6-03).
- **Evidence:** `e2e`, `language-check`.
- **Status:** `open`.

## L07 — Snapping

*Reference work order: C1.*

- **Goal:** Everything stands neatly aligned to its neighbours automatically.
- **Target values:** 16 px grid; snap lines at edges and centres of visible neighbours and zones;
  tolerance 6 px on screen; line 1 px `--accent`, continuous across both elements + 16 px; snapping to
  a line takes precedence over the grid; at most 3 lines at once; snapping live during the drag;
  `Shift` = free (blueprint; reference C1). The snapped position is stored as one `{do, undo}`
  operation `[reference C1]`; measurement ≤ basis + 10 % (blueprint).
- **States:** rest, dragging un-snapped, dragging snapped, `Shift` free, release.
- **Do not:** no lines beyond 3 simultaneous hits; no snap computation during zoom or pan; no
  migration of old positions.
- **Acceptance:** after release `x`/`y` are multiples of 16 (e2e); with `Shift` the position is free
  (e2e); the line is visible while snapped; unit tests of the snap function cover edge, centre,
  tolerance and precedence; measurement not worse than basis + 10 %.
- **Package:** `packages/engine`.
- **Stage:** `engine-core` (blueprint phase 4; P4-04).
- **Evidence:** `cpp-unit`, `e2e`, `perf`.
- **Status:** `open`.

## L08 — Zones as containers

*Reference work order: C2.*

- **Goal:** What lies in a zone belongs to it — visible, stored and reliable.
- **Target values:** dropping with the centre inside a zone makes the object a member (stored); the
  zone is highlighted for 1 s with `--accent-line`; dragging out releases it; dragging the zone moves
  its content in one operation; deleting asks "Inhalt behalten" (default) / "mitlöschen"; shrinking
  never goes below content + 16 px; no nested zones in v1 (blueprint; reference C2). After owner
  approval: a decision record for zones as containers, a nullable parent reference on the board-item
  table (foreign key to the zone, row-level security like the parent board), and parent containment
  with an extent so contained content cannot leave the zone `[reference C2]`.
- **States:** zone empty, drop over zone, member, dragging out, zone dragging, delete dialog, resize
  at the limit.
- **Do not:** do not start before the owner decision (reference C2 waits for it); no nested zones in
  v1.
- **Acceptance:** membership survives a reload (e2e); dragging a zone is exactly one write operation
  (e2e); deletion asks first (e2e); database/RLS test for the parent reference; decision record
  approved.
- **Package:** `packages/contracts`, `packages/engine`, `services/platform`.
- **Stage:** `contract`, `backend-core`, `engine-core` (blueprint phases 1, 3, 4; P1-01, P3-01,
  P4-04).
- **Evidence:** `e2e`, `api-tests`.
- **Status:** `open` — waits for the owner decision on zones as containers (Open points 6).

## L09 — Title in the panel

*Reference work order: C4.*

- **Goal:** The title is changed where the note is read.
- **Target values:** panel title is an input in the same look (serif 24 px, no border at rest,
  underline `--border-strong` on hover and focus); saving goes through the one autosave path of L05;
  same validation as the library; error below the field at 12 px `--danger`, the old title stays
  stored; `Enter` jumps into the editor (blueprint; reference C4).
- **States:** rest, hover, focus, saving, error.
- **Do not:** no own validation; no second save path.
- **Acceptance:** changing the title updates card and library after a reload (e2e); empty or too long
  shows an error and writes nothing (e2e); `Enter` puts the focus into the editor.
- **Package:** `apps/web`.
- **Stage:** `web-app` (blueprint phase 6; P6-03).
- **Evidence:** `e2e`, `language-check`.
- **Status:** `open`.

## L10 — Multi-select

*Reference work order: C7.*

- **Goal:** Several objects can be selected, moved and deleted together as one action.
- **Target values:** `Shift`-click adds or removes; rubber-band selection by dragging on an empty area
  with `Shift` held (without `Shift` the drag still pans the view); selection frame 1 px `--accent`,
  area `--accent-soft`; a bar above the selection shows the count "n ausgewählt" plus delete; a joint
  drag is one write operation; `Esc` clears the selection (blueprint; reference C7).
- **States:** single selection, multi-selection, rubber band, group dragging.
- **Do not:** no one request per selected object; never lose the selection after the drag; no rubber
  band without `Shift`.
- **Acceptance:** dragging three cards sends exactly one request (e2e); the selection survives the
  drag; `Esc` clears it (e2e).
- **Package:** `packages/engine`, `packages/contracts`.
- **Stage:** `contract`, `engine-core` (blueprint phases 1 and 4; P1-02, P4-04).
- **Evidence:** `cpp-unit`, `e2e`.
- **Status:** `open`.

## L11 — Undo/Redo

*Reference work order: C6.*

- **Goal:** A wrong move can be taken back, and one press means exactly one step.
- **Target values:** stack of `{do, undo}` operations, depth 20, per session; `Cmd/Ctrl+Z`,
  `Shift+Cmd/Ctrl+Z`; hint "Rückgängig: …" at the bottom centre for 3 s; with realtime only one's own
  operations (blueprint); the hint uses the design rule §9 place at the bottom centre
  `[reference C6]`. Focus in a field or in the editor: `Cmd/Ctrl+Z` belongs to the field (blueprint;
  reference C6).
- **States:** undo available, redo available, hint visible, focus in a field or the editor.
- **Do not:** in realtime, never undo another person's operation; no more than one counter-operation
  per undo; no undo hint outside the bottom-centre slot.
- **Acceptance:** 20 steps back; one undo sends exactly one counter-request (e2e); undo after deleting
  restores the card (e2e); `Cmd/Ctrl+Z` in a text field changes nothing on the board (e2e); with two
  people, undo of A's change leaves B's changes untouched (two-client e2e).
- **Package:** `packages/contracts`, `packages/engine`, `packages/crdt`.
- **Stage:** `contract`, `engine-core`, `realtime` (blueprint phases 1, 4, 5; P1-02, P4-05, P5-01).
- **Evidence:** `e2e`; unit-level history record and two-client record under `reviews/evidence/`.
- **Status:** `open`.

## L12 — Keyboard and context menu

*Reference work order: C9.*

- **Goal:** Common actions are reachable by keyboard, and the context menu works without a mouse.
- **Target values:** `Cmd/Ctrl+D` duplicates with a +16/+16 offset; `Del`/`Backspace` deletes; `Esc`
  closes panel or selection; arrows move 16 px, `Shift` moves 160 px, each series is one write
  operation 300 ms after the last key; right-click menu 200 px wide, entries 32 px tall ("Öffnen",
  "Duplizieren", "Nach vorne", "Nach hinten", "Löschen"), shortcuts on the right in `--muted`;
  shortcuts never act while the focus is in a field (blueprint; reference C9).
- **States:** rest, menu open, keyboard navigation inside the menu, focus in a field.
- **Do not:** no shortcut acting in a text field; no character or emoji as icon (design rule §5); no
  native `title` tooltip (design rule §5); no menu wider than 200 px.
- **Acceptance:** duplicate and delete by keyboard (e2e); arrow keys land on the grid (e2e); shortcuts
  in a text field have no effect (e2e); the menu is operable by keyboard.
- **Package:** `packages/engine`, `apps/web`.
- **Stage:** `engine-core`, `web-app` (blueprint phases 4 and 6; P4-04, P6-02).
- **Evidence:** `e2e`, `language-check`.
- **Status:** `open`.

## L13 — Layers

*Reference work order: C10.*

- **Goal:** Overlaps are predictable and stay stable across reloads.
- **Target values:** order exactly per design rule §8 (background dot grid, zones, edges, blocks, note
  cards, the just-dragged or selected element on top of its layer, snap guides and selection frame,
  canvas chrome, side panel, context menu and tooltip, dialogs and toasts); the last moved element is
  on top of its layer, stored as a fraction index (blueprint) / through the existing z value
  `[reference C10]`; collisions per owner decision Q15 (blueprint: decision 15).
- **States:** rest, being dragged, after a move, reload.
- **Do not:** no `z-index` above 10 without an entry in `packages/ui-kit/layers.ts` (design rule §8);
  no collision nudge before Q15 is answered (Open points 4); no layer order invented beyond §8.
- **Acceptance:** a note card always lies above blocks; the last moved element is on top after a
  reload (e2e); the layer order is confirmed in a visual comparison.
- **Package:** `packages/engine`, `packages/contracts`.
- **Stage:** `contract`, `engine-core` (blueprint phases 1 and 4; P1-01, P4-02).
- **Evidence:** `visual`, `e2e`.
- **Status:** `open` — blocked by board question Q15 (Open points 4).

## L14 — Resize

*Reference work order: C15.*

- **Goal:** Sizes are changed precisely and stay on the grid.
- **Target values:** no square handles: the 1 px `--accent` frame of a selected object is the handle
  (owner decision 2026-10-28, P0-39) — each edge has a hit band of 8 screen px centred on the line,
  each corner a 16 × 16 px hit square; the frame follows the object's corner radius (P0-41); the
  hovered or dragged edge lights up as a 2 px `--accent` line along its straight part, a corner as
  a 2 px `--accent` arc along the rounded corner; size snaps to 16 px (`Shift`
  free); minimum sizes: note 176×80, checklist 224×128, table 288×160, zone 256×192, columns 368×192,
  timeline 320×160, palette 224×128 (blueprint; reference C15).
- **States:** selected, edge/corner hover, resizing, snapped, `Shift` free.
- **Do not:** no size below a minimum; no second write per gesture; no hit band narrower than 8 px; no visible square handles; no
  size values outside the 16 px grid while not free.
- **Acceptance:** width and height are multiples of 16 (e2e); the minimum size holds; one gesture sends
  exactly one request; the size survives a reload (e2e).
- **Package:** `packages/engine`, `packages/contracts`.
- **Stage:** `contract`, `engine-core` (blueprint phases 1 and 4; P1-01, P4-04).
- **Evidence:** `cpp-unit`, `e2e`.
- **Status:** `open`.

## L15 — Trackpad and touch

*Reference work order: C16.*

- **Goal:** Trackpad and touch gestures feel natural and never mix up moving an object with moving
  the view.
- **Target values:** two fingers move the view, pinch zooms around the finger centre, `Cmd/Ctrl` +
  wheel zooms (blueprint decision 16); touch: one finger on an object drags it, one finger on an
  empty area or two fingers move the view (blueprint; reference C16). Manual check on a touch tablet,
  recorded in the result `[reference C16]`.
- **States:** trackpad pan, pinch, modifier + wheel zoom, touch drag on an object, touch pan on an
  empty area.
- **Do not:** no scroll-to-zoom default before Q16 is answered (Open points 5); never move the view
  while an object is dragged by touch.
- **Acceptance:** a two-finger swipe pans without zooming; pinch zooms around the finger centre; a
  touch drag of an element does not move the view (manual on a touch tablet, note in the result).
- **Package:** `packages/engine`.
- **Stage:** `engine-core`, `hardening` (blueprint phases 4 and 8 — P4-04 desktop, P8-05 touch).
- **Evidence:** `e2e`; manual checklist under `reviews/evidence/`.
- **Status:** `open` — blocked by board question Q16 (Open points 5).

## L16 — Auto-pan

*Reference work order: C17 (auto-pan part).*

- **Goal:** An object can be dragged beyond the visible area without letting go.
- **Target values:** the view scrolls along while an object is dragged into the 48 px edge zone
  (blueprint; reference C17).
- **States:** dragging near the edge, auto-panning.
- **Do not:** no auto-pan when nothing is dragged; no jump of the view; no auto-pan outside the
  48 px edge zone.
- **Acceptance:** an object can be dragged beyond the visible area (e2e).
- **Package:** `packages/engine`.
- **Stage:** `engine-core` (blueprint phase 4; P4-04).
- **Evidence:** `e2e`.
- **Status:** `open`.

## L17 — Remember view

*Reference work order: C17 (remember-view part).*

- **Goal:** After a reload the same section of the board is shown.
- **Target values:** zoom and position stored per board and device; guarded read and write
  (`try`/`catch`) `[reference C17]`; without a stored entry "Alles anzeigen"; the view is restored on
  opening; a new board starts fitted (blueprint; reference C17).
- **States:** stored entry present, no entry (new board), reload.
- **Do not:** no unguarded storage access that can throw; no viewport shared across boards; no stored
  view changed outside a user action.
- **Acceptance:** a reload shows the same section (e2e); a new board starts fitted.
- **Package:** `packages/engine`, `apps/web`.
- **Stage:** `engine-core`, `web-app` (blueprint phases 4 and 6; P4-01, P6-02).
- **Evidence:** `e2e`.
- **Status:** `open`.

## L18 — Inline comfort

*Reference work order: C11.*

- **Goal:** Lists, tables and columns can be filled with the keyboard only.
- **Target values:** checklist, columns and table: `Enter` creates a new entry below with focus;
  `Tab`/`Shift+Tab` move to the next/previous field; `Backspace` in an empty entry deletes it and puts
  the focus on the previous entry; the colour picker is a 24 px colour field (blueprint; reference
  C11).
- **States:** field focus, typing, empty entry, last entry.
- **Do not:** no oversized native colour button; no second save path (the one autosave of L05 is
  used); no additional inline input pattern.
- **Acceptance:** three points are created with the keyboard only (e2e); an empty point is deleted
  with `Backspace` (e2e).
- **Package:** `packages/engine` (overlay), `apps/web`.
- **Stage:** `engine-core`, `web-app` (blueprint phases 4 and 6; P4-08, P6-02).
- **Evidence:** `e2e`.
- **Status:** `open`.

## L19 — Canvas feel

*Reference work order: C12.*

- **Goal:** The canvas feels calm: it fits, never zooms past 100 % and does not draw without a change.
- **Target values:** "Alles anzeigen" zooms at most to 100 % and keeps the padding of L02 (≥ 64 px
  free at the top); the dot grid hides below zoom 0.5; draw only on change (blueprint); no mini-map
  and no cleanup in v1 (reference C12).
- **States:** fitted with one card, zoomed out below 0.5, idle.
- **Do not:** no mini-map or cleanup in v1; no frames while idle; no fit above 100 %.
- **Acceptance:** fitting with one card zooms no further than 100 %; the dot grid is hidden below
  zoom 0.5; no frames while idle.
- **Package:** `packages/engine`.
- **Stage:** `engine-core` (blueprint phase 4; P4-02).
- **Evidence:** `visual`, `perf`.
- **Status:** `open`.

## L20 — Placement of new objects

*Reference work order: C18.*

- **Goal:** A new object appears where it can be seen and used.
- **Target values:** new object in the centre of the view, on the grid; if the place is taken, offset
  32 px to the right and down each time, at most 10 attempts (blueprint; reference C18).
- **States:** free place, place taken, maximum attempts reached.
- **Do not:** no placement outside the visible area; no position off the 16 px grid; no more than 10
  attempts.
- **Acceptance:** five times "Notiz hinzufügen" gives five visible, non-overlapping cards (e2e); unit
  coverage of the placement function recorded under `reviews/evidence/`.
- **Package:** `packages/engine`, `packages/contracts`.
- **Stage:** `engine-core` (blueprint phase 4; P4-04).
- **Evidence:** `e2e`; unit record under `reviews/evidence/`.
- **Status:** `open`.

## Mapping table — entries to reference work orders

| Entry | Reference work order(s) | Note |
| --- | --- | --- |
| L00 | C0 | toolbar work order; the toolbar-token item of C19 also belongs here |
| L01 | C13a, C13b | basis measurement and final proof |
| L02 | C19 | visible defects 1–7; item 8 (toolbar tokens) belongs to L00 |
| L03 | C14 | drag and edit separation |
| L04 | C8 | panel overlay |
| L05 | C3 | live saving with status |
| L06 | C5 | empty note |
| L07 | C1 | grid and snap lines |
| L08 | C2 | zones as containers |
| L09 | C4 | note title in the panel |
| L10 | C7 | multi-selection |
| L11 | C6 | undo/redo |
| L12 | C9 | keyboard and context menu |
| L13 | C10 | layers and overlap |
| L14 | C15 | resize |
| L15 | C16 | trackpad and touch |
| L16 | C17 (auto-pan part) | view scrolls while dragging to the edge |
| L17 | C17 (remember-view part) | viewport per board and device |
| L18 | C11 | inline comfort |
| L19 | C12 | canvas feel |
| L20 | C18 | placement of new objects |

## Unassigned reference work orders

None. Every reference work order `C0`–`C19` (with `C13` split into `C13a`/`C13b`) maps to an entry in
the table above, so no entry had to be invented and none stays unassigned. `C0` lies outside the
`C1`–`C19` range named in the task brief; it is the toolbar work order and maps to L00. `C19` is
shared between L00 (toolbar tokens, item 8) and L02 (visible defects 1–7), and `C17` is shared between
L16 (auto-pan) and L17 (remember view).

## Open points

1. **Performance numbers differ.** Blueprint L01 names 10,000 objects at 60 fps and no long task >
   16 ms while panning/zooming; reference C13b names 500 cards + 50 zones without a long task >
   50 ms while zooming and panning. Both are kept in L01: the blueprint values are the product
   target, the reference values are the baseline-comparison proof. The lead confirms with the owner
   which one the final `perf` gate reports as primary (Open point, no value dropped).
2. **Snap timing differs.** Blueprint L07 requires snapping live during the drag; reference C1
   records the earlier implementation's deviation (the element follows freely and the snapped
   position is set on release; live snapping is still open). The catalogue target is the blueprint's
   live snap; L07 stays `open` until that is evidenced.
3. **Layer storage differs.** Blueprint L13 stores "last moved on top" as a fraction index; reference
   C10 stores it through the existing z value. Both are kept in L13; the representation is decided
   with the contracts before `engine-core`.
4. **Q15 — collisions (L13).** Board question: clear layers only (proposal) or a gentle nudge; needed
   before `engine-core`. L13 stays `open`; no nudge is built before the answer. The reference's owner
   decision 4 is the same question.
5. **Q16 — trackpad (L15).** Board question: two fingers pan and pinch zooms (proposal) or scroll
   zooms; needed before `engine-core`. L15 stays `open`; the proposal is the target until the owner
   answers. The reference's owner decision 7 is the same question.
6. **Zones as containers (L08).** Reference C2 waits for owner decision 1 (a decision record plus a
   migration); the board has no matching question. L08 stays `open`; nothing is built before
   approval. On approval a decision record is created under `docs/adr/`; the reference's
   earlier-prototype record number is not carried over.
7. **Measurement bookkeeping.** Blueprint L01 expects the measured values entered in the catalogue;
   the reference keeps a separate measurement table; the task brief keeps measurement bookkeeping out
   of the entries. Resolution: the numbers live in the `perf` evidence records (basis and final) and
   are quoted in the L01 result with date and path; this catalogue keeps target values only. L01 is
   not `fulfilled` before the final proof record exists.
8. **Rules tied to the earlier prototype were dropped.** The reference's cross-section rules name a
   specific web canvas library and its props, a specific editor library, prototype source paths, a
   prototype storage key, package-manager commands and implementation-history notes with version
   numbers. None of them are carried over. The reference's legacy-coordinate premise does not exist in
   this project, so that rule survives only as the general no-hand-migration rule of the cross-section.
   Consequence: the preference for built-in canvas primitives is written technology-neutrally, and the
   canvas technology is decided in `engine-spike`. The
   prototype's sample-board name in C19 is replaced by "sample board", and its named test device in
   C16 by "touch tablet".
9. **Changelog process differs.** The reference asks for one changelog command per work order; this
   project uses change entries and the `changelog-entry` gate from P0-14 instead.
10. **Deferred, not entries.** The reference's extensions list (drag-to-connect, share links, kanban
    automation, realtime collaboration, offline, native apps) and its not-in-v1 list (database views,
    payments, account management, uploads beyond PDF/XLSX, own templates) are not canvas work orders
    and do not become entries. The reference's process section and tester script also do not become
    entries; the process is in "How to use".
11. **Blueprint task ids do not exist on the board.** `P1-01`, `P4-04` and the other blueprint task
    ids are kept only in brackets in the **Stage** field. Stage gates use the board stage ids from
    the table in "Stage mapping".
12. **L00 has no detailed values of its own in the reference.** Reference C0 records only that the
    toolbar existed in the earlier prototype; its detail is the toolbar-token item of C19. The L00
    numbers therefore come from blueprint 21.2 plus that C19 item, and the 48 px bar height follows
    from the 64 px fit padding (bar 48 px + 16 px). This is a source gap, not a contradiction.
