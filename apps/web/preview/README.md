# Design preview (P0-19, P0-20, P0-21, P0-22, P0-23, P0-24, P0-25, P0-26, P0-27, P0-28, P0-29, P0-30, P0-31, P0-32, P0-33, P0-34, P0-35, P0-36, P0-37, P0-38, P0-39, P0-40, P1-07)

A design preview of the Project air design system. It is **not the product**: there is no engine,
no data, no server and no build step. It exists so the owner can see the look and feel between
milestones — the top section is a small live interaction demo, the rest is static token, component
and contract documentation.

## Version and last change

The masthead identifies which build the preview represents. The line is static in `index.html` with
stable `data-preview-*` hooks — no runtime parsing of `CHANGELOG.md` or the `.changes/` folder — and
its two values come from:

- **Version** — the first `##` heading of [`CHANGELOG.md`](../../../CHANGELOG.md), currently
  `0.0.1 – unreleased`; the status word comes from the same heading. `CHANGELOG.md` is the display
  source and currently agrees with the root `package.json` version `0.0.1`.
- **Last change** — the newest preview change entry, currently
  `.changes/P0-40-teammates.md`; the line shows the task id and that task's title from
  `board.json` / the task brief: `P0-40 — Live demo: two teammates on the board`. The line follows the
  `P0-*` preview tasks (P0-19 … P0-40, P1-07); the engine tasks
  (`P4-*`) and the other stages run in parallel and do not move it, so "highest numeric id" alone is
  not the rule. If several files exist for the same preview task, the most recent one is used;
  `.changes/README.md` and `.changes/TEMPLATE.md` do not count as entries.
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
- A **top-centre floating toolbar** (preview-only) with the ten tools note (selected initially),
  link, image, file │ zone, checklist, palette, columns, timeline and table, using the ui-kit icon
  files through the existing `.icon--*` mask classes.
- A **zone** with a notepad and a small image window that shows the owner-supplied demo photo. The
  zone lays the two items side by side or stacked depending on where the drop lands, a docked item
  can be reordered or swapped inside it (P0-30), both items can be dragged out onto the canvas and
  docked back (P0-28); when both are out the empty zone fades away (P0-29) and dragging the two
  free items together forms a new zone around them. While dragging, the zone previews the release
  (landing slot, room-making, shrinking and ghost frames) and every settle uses one calm ease-out
  (P0-31). Every zone carries a name in its header that can be renamed inline (P0-32). There is no
  upload, no file handling and nothing is saved.
- A small floating **zoom pill** in the demo (preview-only): zoom in, zoom out and fit stacked
  vertically, drawn with CSS shapes and labels from the locale files (28 px visual buttons in a
  32 px pill, 12 px glyphs, 32 × 32 px hit areas).
- A **DE/EN switch** at the top right of the masthead: the whole page (all text, `aria-label`s,
  `alt` texts and the document title) switches between English and German, the choice persists in
  `localStorage`, and `<html lang>` follows the switch.
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
remote images and no framework, and no build step: the bilingual texts are plain JSON files that
`preview.js` fetches over HTTP (`locales/en.json`, `locales/de.json`). The old "no images" rule has
exactly one documented exception: the local, owner-supplied demo photo
`assets/demo-zone-image.webp` in the static zone (1135 × 829 WebP, about 74 KB). It is a relative
local path, not a data URI and not a remote URL, and it is the only image in the preview.

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
  layer below the zones and cards (`--layer-zones`, `--layer-note-cards`; ADR-0013) and keeps the design-system connection style — a
  `--tone-d` stroke at 1.5 px (`--border-width-strong`) with `--tone-d` endpoint dots.
- **Zoom pill (preview-only):** one floating vertical control sits 12 px from the bottom-left corner
  of the demo surface — a 32 px container (`--click-target`) with `--radius-md`, `--surface`
  background, a 1 px `--border` outline, no block padding and three stacked segments (zoom in, zoom
  out, fit), each a **32 × 32 px hit area** whose painted button is 28 × 28 px (a `::before` inset by
  `--space-4 / 2`), separated by 1 px `--border` rules and drawn with 12 px glyphs (`--space-12`). The `+`, `−` and fit-corner glyphs are drawn with CSS shapes only; every
  segment has an `aria-label` from the locale files plus a CSS tooltip (`Zoom in`, `Zoom out`,
  `Fit to view` in English; `Vergrössern`, `Verkleinern`, `Alles anzeigen` in German) and
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

## The preview toolbar and zone (P0-26)

The demo also carries the canvas chrome and one zone/content composition from the design system.
Both are **preview-only**: no toolbar action touches the canvas, and the zone is static demo content
(no upload, no file handling, no engine).

- **Toolbar** — one floating pill at the top centre, 12 px (`--space-12`) from the surface edge, with
  a `--surface` background, a 1 px `--border` border, `--radius-pill`, `--shadow`, 8 px padding
  (`--space-8`) and 4 px gap (`--space-4`). Ten 36 × 36 buttons (`--button-bar`) with 20 px icons
  (`--icon-bar`) in the owner's order: note (selected first), link (`source.svg`), image, file │
  zone, checklist, palette, columns, timeline and table; the 1 × 20 px group divider after "file"
  uses `--border-width` and `--icon-bar`. The icons are the ui-kit SVGs through the existing
  `.icon--*` mask classes, so they only ever take token colours through `currentColor`.
- **Toolbar states** — every button has all design states: rest `--muted` on transparent, hover
  `--faint` background with the icon in `--fg` and a `--border-strong` border, focus-visible a 2 px
  `--accent` outline, pressed `scale(0.97)`, and selected `aria-pressed="true"` with an
  `--accent-soft` background, an `--accent-line` border and an `--accent` icon. Every button has an
  `aria-label` and a `data-label` tooltip from the locale files (never the native `title`
  attribute).
- **Toolbar selection** — clicking or pressing a tool flips `aria-pressed` and names the tool in the
  demo status line; the note tool is selected in the markup. Nothing else changes: the cards, the
  edge and the zoom scale stay where they are.
- **Zone** — a static zone card at the centre of the canvas with a `--card` background, a 1 px `--border`
  border and `--radius-md`. It contains a 240 px notepad (`--surface`, 1 px `--border-strong`,
  `--radius-sm`, `--text-15` title, `--text-13` body) and a 240 × 140 px image window with a 32 px
  title bar, a 1 px `--border` border, `--radius-md` and the photo as `object-fit: cover` with a
  small `--radius-sm`. The image has a translated `alt` text (English fallback in the markup) and
  intrinsic `width`/`height`; when the
  local asset is missing the fixed window box keeps its size and shows the `--canvas` placeholder
  background, so nothing shifts.
- **Layers** — the zone uses `--layer-blocks` (an existing entry of
  `packages/ui-kit/layers.ts`, no numeric z-index): above the canvas background and the connecting
  edge, below the note cards (`--layer-note-cards`), the dragged/selected card and the canvas chrome
  (`--layer-canvas-chrome`: toolbar and zoom pill). The connection therefore passes behind the zone,
  as the layer model says.
- **Compact viewports (viewport at most 900 px)** — the surface becomes a two-row grid: the
  toolbar keeps the top centre as its own row (one row, or two wrapped rows when the viewport is
  narrower than about 461 px) and the world layer fills the rest, so both cards keep their
  4 %/5 % and 90 %/90 % home positions of the world and stay clear of the toolbar, the zone and the
  zoom pill. The surface grows to `--canvas-grid` × 54 because the zone needs the vertical room
  between the two card homes. From a 901 px viewport the toolbar floats over the canvas again. A width matrix of 390, 480, 520, 521, 600, 700,
  768, 860, 900, 901, 1000, 1200 and 1440 px shows no overlap between toolbar, zone, cards and zoom
  pill and no horizontal page overflow; the measurement is in
  `reviews/evidence/P0-26-preview.log`. The card geometry, the edge anchors and the zoom maths
  measure the world layer instead of the surface, so the edge stays exactly on the anchors in both
  layouts; on desktop the world layer and the surface are identical and the demo behaves exactly as
  before.

## Zone interaction: live release preview and one calm motion (P0-28 → P0-31)

The notepad and the photo window are draggable canvas objects, not static decoration. P0-30 made
the drag "commit on release"; P0-31 reworks the whole interaction so that pulling the items apart
and together is predictable: during the drag the zone **shows** what a release would do, and the
release only confirms it.

- **Frame and items** — the zone card is only a frame drawn around its docked items. The first
  layout pass measures the static card grid (the no-script look), moves both items onto the zone
  layer and from then on positions frame and items in world coordinates. The frame is laid out from
  the docked items only: item sizes plus 16 px padding (`--space-16`) and a 12 px gap
  (`--space-12`), side by side or stacked, below the 40 px name header (P0-32). One docked item → a one-item frame; no docked item → the
  frame is hidden. Sizes are re-measured on resize, locale switch and content reflow
  (`ResizeObserver`).
- **1:1 drag** — pointer events with `setPointerCapture`, one active drag, mouse, pen and touch; the
  4 px threshold (`--drag-threshold`) starts it. The dragged item follows the pointer exactly
  (clamped only at the canvas edge, measured against the rendered zoom so it stays 1:1 even while a
  zoom transition runs) and lifts: scale 1 → 1.02, the stronger `--shadow`, top of its layer.
- **Live preview, nothing committed** — on every move the script decides the release outcome and
  shows it:
  - **dock / reorder** (the item is over the zone): the frame grows to its new size with a lifted
    border, a recessed dashed **landing slot** (`.demo-zone__placeholder`) marks where the item
    will land and the other docked item glides aside to **make room**;
  - **pull out** (the item left the zone): the frame shrinks around the remaining item, which keeps
    its place; when the last item is being pulled out the frame turns dashed and dims (`emptying`);
  - **group** (a free item over the other free item): a dashed **ghost frame** appears around the
    pair, with the landing slot next to the item that is not moved;
  - **free**: no slot, the committed frame.
- **Thresholds (screen px, zoom-independent)** — entering the zone needs the pointer over the frame
  that is shown or the item covering **25 %** of it; staying inside allows a **24 px catch margin**
  around the previewed (grown) frame. That band is the hysteresis (the frame grows when the item
  enters, so the boundary never flickers) and also the ramp of the detach look (docked ring →
  free shadow). Grouping needs **20 %** overlap of the smaller item or the pointer within **16 px**
  of the other item; once the ghost shows, any contact (32 px) keeps it. Orientation follows the
  placement, with the centre offsets measured in item sizes (so a tall photo beside a short notepad
  still reads as side by side), a **1.25** dominance ratio (near-diagonal keeps the current one)
  and no change while the offsets are under **half an item** (an item held right on top of the
  other keeps the orientation); the order has a **12 px** midpoint band. An item that started
  docked also counts as inside while it is over its committed frame.
- **Who stays put** — the item that is not dragged never jumps: a free item docking into a one-item
  zone grows the frame around the docked item; grouping builds the frame around the item that was
  not moved; pulling an item out shrinks the frame around the one that stays. Only a reorder inside
  a full zone keeps the frame where it is and lets the other item make room. Every frame is clamped
  into the **visible** surface rectangle and, on desktop, below the floating toolbar
  (`--space-8` below it); when the requested orientation does not fit, the other one is used (side
  by side falls back to stacked at 390 px and returns when the surface is wider again).
- **Release commits** — the shown outcome becomes state: dock (`Image window docked back in the
  zone.`), reorder (`Order changed inside the zone.`), orientation flip (`Orientation changed inside
  the zone.`), group (`Items grouped side by side / stacked into a new zone.`), detach (snapped to
  the 16 px canvas grid, `… detached — free on the canvas.`) or collapse (`Zone hidden — …`). A
  `pointercancel` or a lost pointer capture restores the committed state: the item glides back to
  where the drag started and the frame returns. A hidden zone is inert; only grouping brings it back.
- **One motion language** — every settle (items gliding to a slot or the grid, the landing slot
  moving, the frame moving or resizing, the collapse fade) uses the same curve:
  `--demo-settle` = `--motion-panel` + `--motion-hover` (300 ms) with the ease-out
  `cubic-bezier(0.2, 0, 0, 1)`, **no overshoot** (design law §7: no springs or bounce). The lift,
  ring and shadow use `--motion-fade`. Only `transform` (`translate`, `scale`) and `opacity`
  animate: the frame takes its new size at once and is scaled back from the rectangle it currently
  shows (FLIP), so the resize never animates `width`/`height`; an unchanged target never restarts
  the animation. Resize, locale reflow and the first layout pass land instantly (`is-instant`).
- **Resize** — the cards, the free items and the zone keep their relative place (centre ratio of the
  world size), so widening the window after a narrow load no longer leaves card B on the left; the
  zone is re-fitted and re-clamped and the docked items follow their slots.
- **No edge** — the demo keeps exactly one edge element (`.demo__edge`, cards A ↕ B); its path never
  changes when a zone item moves, reorders or groups. Zone items are never connected.
- **Z-order** — the zone frame sits at `--layer-zones` (above the edge, as in design law §8 since ADR-0013), the
  items and the landing slot at `--layer-blocks`; the last touched item is selected and sits at
  `--layer-dragged-or-selected` while and after its drag (a drop near a note card or onto the
  other item never hides it), all below the canvas chrome (toolbar and zoom pill); no numeric
  z-index.
- **Reduced motion** — under `prefers-reduced-motion: reduce` every zone transition is off and the
  lift scale is dropped; previews and commits apply their end state immediately.

## Zone name (P0-32)

Zones carry a name. The frame has a **40 px header** (`--space-24` title box + `--space-16`), and
the content starts **40 + 16 px** below the frame's inner top edge, as `docs/canvas-acceptance.md`
L02 asks for zones.

- **Display** — one line, 13 px semibold `--fg` (`--text-13`, `--weight-semibold`), 24 px box with a
  4 px inner padding and `--radius-tooltip`, ellipsis when the name is wider than the frame; hover
  shows `--faint`, editing shows `--surface` with the `--accent` focus outline.
- **Not scaled** — the title is not a child of the FLIP-scaled frame (its text would stretch while
  the frame resizes); the script places it on the zone layer at the frame's header and moves it with
  the same settle curve, so frame and name arrive together. Ghost and emptying frames dim it to
  0.6 and make it inert; a collapsed zone fades it out with the frame.
- **Rename** — the title is a plain-text editable field (`contenteditable="plaintext-only"`, falls
  back to `true`; `role="textbox"`, `aria-label` from the locale files). Clicking it selects the
  whole name, so typing replaces it. **Enter** or leaving the field commits ("Zone renamed to
  “…”."), **Escape** restores the previous name, an **empty** name returns to the default ("Zone
  name reset to “…”."), whitespace is collapsed and the length is capped at **40 characters**. Item
  drags never start from the title.
- **Defaults and language** — the start zone is called "Lake trip" / "Ausflug an den See"; a zone
  formed by grouping two free items starts as "New zone" / "Neue Zone" (the ghost frame already
  shows it). A default name follows the DE/EN switch; a typed name stays exactly as typed. Names
  live only in this page's memory, like everything else in the demo.
- **Without script** — the title is the first row of the static card grid.

## Two teammates on the board (P0-40)

Owner request of 2026-10-28: show two more people working on the same board. Lena (`--tone-b`)
and Jonas (`--tone-c`) are simulated teammates that follow design law §12 and the presence model
of P5-05 (cursor, selection, name, colour; ephemeral):

- **Cursors** — a 16 px pointer in the person's colour (a CSS shape: the ui-kit has no cursor icon
  and its icon set is fixed at ten) with a 12 px name label on a surface in that colour, `--bg`
  text. They sit in `.demo-team-layer` on `--layer-remote-cursors` (7a): above objects, frames and
  guides, below the toolbar and zoom pill, and never take pointer input.
- **Routes** — each cursor loops over demo objects: Lena checklist → table → note A, Jonas photo →
  zone header → note B. Legs glide 600–1200 ms with an ease-out (no overshoot, `transform` only),
  then dwell. Waypoints are fractions of the target's rendered box, so cursors and frames stay on
  their objects through drags, resizes, zone moves and zoom; a deleted target is skipped.
- **Selections** — while dwelling with a selection, the object shows a 1.5 px frame in the
  person's colour, without a ring. The viewer's selection, content, undo history and status line
  are never touched.
- **Idle** — after 5 s at rest a cursor fades to 0.4 (`--motion-fade`); one long dwell per loop
  shows it.
- **Presence line** — "On this board: You, Lena, Jonas — simulated teammates, nothing is sent"
  above the canvas (not a floating element, §9), with 8 px colour dots.
- **Cost** — the loop runs only while the canvas is on screen and the page is visible
  (IntersectionObserver, `visibilitychange`); frame steps are capped at 100 ms. Under reduced
  motion cursors jump and fades are 0 ms.

## Quiet resize frame, dimmed done items, design rules (P0-39)

Owner requests of 2026-10-28:

- **Resize frame without handles** — the eight 8 px squares are gone. The 1 px `--accent` frame is
  the handle: an invisible 8 px band centred on each edge (between the corners) and a 16 × 16 px
  square on each corner, with the matching resize cursor. Only the hovered or dragged edge lights up
  as a 2 px accent line (`--outline-width`), a corner as a 16 px accent bracket
  (`--space-16`), fading in at `--motion-hover` (0 ms under reduced motion). Hit areas and lines
  keep their screen size at every zoom. Resize behaviour is unchanged. Section 10 shows the frame
  with one lit edge and one corner bracket. L14 in `docs/canvas-acceptance.md` says the same; the
  engine's P4-17 handles still follow the old target and need their own engine task.
- **Done checklist items** — a ticked entry turns `--muted` and is no longer struck through; design
  law §6 has the "Done (checklist entry)" row.
- **12 — Design rules** — a new section lists every rule of `docs/design-rules.md`, §0 to §14
  (15 cards, 66 lines), with MUST/NEVER marked and a pointer to the section of this page that shows
  the rule. The texts live in `en.json`/`de.json` (`rules.*`).

## Layer order: edges below zones (P0-38)

The owner decision of P0-36 is now the design law (ADR-0013): connection lines lie below every
object, zones included.

- **Law and tokens** — design law §8 reads canvas background 1, edges 2, zones 3, blocks 4 …
  dialogs 11; `packages/ui-kit/tokens.json` holds `edges` 2 and `zones` 3, and the generated
  `tokens.css`, `tokens.h` and `layers.ts` follow.
- **Section 06** — the layer list shows edges (2, `--layer-edges`) before zones
  (3, `--layer-zones`).
- **Demo edge** — `.demo__edge` uses `--layer-edges` again; the local deviation comment of P0-36 is
  gone. The line still runs below the zone card, the blocks and the note cards.

## Engine canvas chrome in the live demo (P0-37)

The stage-5 chrome that the design page shows in section 10 now works on the demo objects (rules
from `docs/engine.md`):

- **Snap guides (L07)** — dragging a note card, a block or a free zone item snaps its edges and
  centre to those of the other objects and the zone frame within `--snap-tolerance` (6 screen px);
  one 1 px accent guide per axis, 16 px past both objects; Shift moves freely. Docked members do not
  snap (they reorder).
- **Zone drop highlight (L08)** — a dock or a group outlines the zone in `--accent-line` for 1 s.
- **Rubber band and multi-selection (L10)** — Shift-drag on the empty canvas draws the band
  (`--accent-soft` fill, 1 px accent border); on release every touched object gets a 1 px accent
  frame and the count bar "n selected" with a delete button appears — centred above the selection,
  below it when there is no room, always inside the visible canvas, the same screen size at every
  zoom. A press on one object replaces the multi-selection. Moving a multi-selection as a group is
  not part of the demo.
- **Delete and undo (L11)** — the count bar, `Delete`/`Backspace` and the menu delete hide the
  selected objects (a docked member leaves its zone). `Cmd/Ctrl+Z` undoes the last step (depth 20):
  every press records the demo state, a release that changed it becomes one step labelled by what
  changed (move, resize, dock, take out, group, move zone, rearrange, delete, delete zone). The hint
  "Undo: …" shows for 3 s in the bottom-centre slot (design law §9). Checklist ticks and title
  edits are content, not history.
- **Context menu (L12)** — right-click on an object, `Shift+F10` or the menu key: Open, Duplicate
  (⌘D), Bring forward, Send backward, Delete (Del); 200 px wide, 32 px rows, shortcuts in `--muted`,
  arrows wrap, Enter/Space run, Esc/outside/blur close. Open and Duplicate only announce that they
  come with the web app and the board data; forward/backward reorder within the layer.
- **Zone header delete (L02)** — the quiet trash in the zone header appears on hover or focus and
  deletes the zone while keeping its items on the canvas (undoable).

## Select and resize, photo, edges behind (P0-36)

Owner request 2026-10-28: everything can be enlarged and lengthened, the photo has no bar, a photo
dropped into a zone takes its size, and the connection lines run behind all cards.

- **Selection chrome** — a click on a note card, the notepad, the photo, the checklist or the table
  card selects it and shows the engine's chrome (L10/L14): a 1 px `--accent` frame and eight 8 px
  `--accent` handles on the snap-guide layer, kept 8 screen px at every zoom (`--chrome-inverse`)
  with an invisible 16 px hit area. The chrome follows the object's rendered box every frame while
  something is selected (drags, settles, zoom). A click on the empty canvas or `Esc` clears it. Only
  the last touched object stays raised above its layer neighbours.
- **Resize** — a handle drag resizes against the opposite edge or corner, 1:1, clamped to the
  canvas. Minimums: note cards 176 × 80 (contract), photo 128 × 96, notepad 176 wide; the notepad,
  the checklist and the table card never get lower than their content (they grow, L02); note cards
  clip their text. A resized note card redraws its edge; a resized docked member re-lays its zone,
  which keeps its top-left corner (a window resize still keeps the centre ratio). The zone frame
  itself has no handles: its size follows its members.
- **Photo** — no title bar; the image fills the window (`object-fit: cover`). Free, it resizes
  freely; docked into a zone with another member it takes that member's width (stacked) or height
  (side by side) and keeps its aspect ratio.
- **Edges behind (owner decision)** — `.demo__edge` runs below every object, zones included. Since
  P0-38 this is design law §8 (ADR-0013): edges are layer 2 (`--layer-edges`), zones layer 3.

## Design system refresh (P0-35)

An audit on 2026-10-28 compared the page with the repository and updated it:

- **Contract overview → 0.3.0** (was 0.1.0): 17 schema files (11 board content incl. the `reorder`
  payload, 1 sync, 5 REST API), 20 operation types (`reorder` marked new), sync 6 + 6 and 7 error
  codes unchanged, 86 parity fixtures (37 valid, 49 invalid), a "Containment rule" family
  (`fixtures/containment/`, 0.2.0), the 0.3.0 sync rules (version negotiated once per connection,
  fresh-board `serverSeq`, `snapshotRef`) and a version history 0.1.0 / 0.2.0 / 0.3.0. Sources:
  `board.json` `contracts[]`, `docs/contracts.md`.
- **06 — Motion, interaction and layers** (new): every token that was missing — the five motion
  durations (point at a row to play it), drag threshold, snap tolerance, mouse and touch targets,
  header height, focus ring width/offset with a focus specimen, and the twelve layers of
  `packages/ui-kit/layers.ts` including 7a. Now every token of `tokens.css` appears on the page.
- **10 — Canvas chrome** (new): static token-only specimens of the stage-5 engine chrome — zone and
  block header (40 px band in `--faint`, rule in `--border`, quiet delete), selection frame with
  eight 8 px handles and the count bar, rubber band, snap guides, the one-second zone highlight in
  `--accent-line`, the undo hint in the bottom-centre slot and the 200 px context menu. The delete
  icon is the inline stroke trash the engine playground uses (`packages/ui-kit/icons` has no delete
  icon yet).
- **Removed:** nothing left the system; only the 0.1.0 counts and texts went away. Sections 06–09
  moved to 07–09/11.

## Moving a zone (P0-34)

A zone moves as a whole, the way ADR-0010 describes containers (the engine follows in P4-27/P4-29):

- **Grip** — the frame's padding and its header outside the name (`cursor: grab`). A member still
  drags only itself, a click on the name still renames, and a press without movement does nothing.
- **Move** — after the 4 px threshold the frame, its name and every docked member follow the pointer
  1:1 with transitions off and a lifted frame (`--shadow`); the frame is clamped by the same layout
  functions as every zone change (inside the visible surface, below the toolbar on desktop), so the
  members keep their slots. Free items, note cards, blocks and the edge never move.
- **Release / cancel** — the release commits the new origin and announces "Zone moved." /
  „Zone verschoben.“; a `pointercancel` or a lost capture glides frame and members back. A member
  pulled out afterwards docks back into the slot at the new place.
- **Exclusive** — a zone move and a member drag never run at the same time; resize and locale reflow
  during a move are deferred; ghost and collapsed frames are inert.
- **Layers** — the frame stays on `--layer-zones`, so a zone moved over the checklist or the table
  card passes under that block (design law §8: zones below blocks).

## Checklist block and spreadsheet card (P0-33)

Two more canvas objects on the blocks layer (design law §8: below the note cards; the last touched
block rises to the dragged-or-selected layer):

- **Checklist** ("Trip checklist" / "Checkliste Ausflug") — five example items with real checkboxes
  and labels (each row a 32 px click target), two done at start. A tick dims the item's text to `--muted` without striking it through (P0-39),
  the header counter shows done/total ("3/5", `aria-label` "3 of 5 done") and the status line
  announces "“Pack the picnic” done — 3 of 5.". Space toggles a focused checkbox.
- **Spreadsheet card** ("Trip budget" / "Budget Ausflug") — a semantic table in a grid role with
  column letters A–D, row numbers 1–6, a header row (item, quantity, price, total), four rows and a
  total row. Totals are computed by the script (`D = B × C`, `D6 = SUM(D2:D5)` = 197.50; the markup
  carries the same values for the no-script look). A click or the arrow keys select a cell; the
  formula bar shows its reference and its formula (`=B4*C4`, `=SUMME(D2:D5)` in German) or value.
- **Drag** — both blocks drag 1:1 after the 4 px threshold, clamp to the canvas and keep their
  relative place on resize. A drag never starts on a checkbox or label, a press without movement is
  a click (tick, select a cell), and a drag never ends in a click on what lies under the pointer.
- **Places** — desktop: checklist top right above note B, table bottom left between the zoom pill
  and the zone (homes as shares of the free world space, `data-home`). Compact layout (≤ 900 px):
  the world grows to `--canvas-grid` × 104 and the blocks get their own homes (`data-home-compact`)
  so note A, checklist, zone, table and note B stack without overlap at 390 px.

## Bilingual preview and the DE/EN switch (P0-27)

The page is bilingual: English is the markup fallback and German comes from a locale file, so the
preview renders English before any script runs and still works without JavaScript.

- **Locale files** — [`locales/en.json`](locales/en.json) and [`locales/de.json`](locales/de.json)
  hold every visible string and every translated attribute, grouped by page section in
  lowerCamelCase keys (`masthead.*`, `demo.*`, `contract.*`, `colours.*`, `type.*`, `space.*`,
  `icons.*`, `states.*`, `components.*`, `board.*`, `footer.*`, `locale.*`). Both files have exactly
  the same key set; a key that exists in only one file is a bug. German follows
  [`docs/i18n/style-de.md`](../../../docs/i18n/style-de.md) and the terms of
  [`docs/i18n/glossary.md`](../../../docs/i18n/glossary.md) (Leinwand for canvas, Seitenpanel for
  side panel, Zeitstrahl for timeline, Werkzeugleiste for toolbar, Board stays Board): du-form,
  calm, no exclamation marks, always `ss`, never the sharp-s character, and no German string lives
  in `index.html`, `preview.css` or `preview.js` (the `language-check` gate enforces that).
- **Markup hooks** — `data-i18n="<key>"` replaces the element's text, `data-i18n-html="<key>"`
  replaces its inner HTML (for sentences that contain inline `<code>`, `<kbd>`, `<strong>` or links),
  and `data-i18n-attr="aria-label:<key> alt:<key>"` sets attributes. The English text stays in the
  markup as the no-JavaScript and fetch-failure fallback.
- **Controller** — `preview.js` fetches `locales/<lang>.json` relative to the page, applies the
  strings and attributes, sets `<html lang>`, marks the active switch option with `aria-pressed` and
  stores the choice in `localStorage.preview-locale` (default `en`). A failed load never changes the
  page on its own: the language and the toggle state stay exactly as they are actually applied
  (requesting German while `de.json` is unavailable leaves an English page on `EN`, and requesting
  English while `en.json` is unavailable leaves a German page on `DE`). Only on the first load,
  when nothing has been applied yet, does the page settle once on the English markup fallback (or on
  `locales/en.json` when that file loads), so the switch never shows a language the page does not
  display. There is no retry loop and no console error.
- **Switch** — a compact segmented `DE │ EN` pill at the top right of the masthead meta row. Each
  option is a real button and a 32 × 32 px target (`min-inline-size` and `min-block-size`
  `--click-target`, measured 33 × 32 px) with 8 px horizontal padding (`--space-8`); the pill around
  the two options is 34 px high (the 32 px option plus the two 1 px `--border` borders) and 70 px
  wide, with `--radius-pill`, `--surface` background, rest `--muted`, hover `--faint`, pressed
  `scale(0.97)`,
  focus-visible `--accent` outline and selected (`aria-pressed="true"`) `--accent-soft` background
  with `--accent` text. The group and both options have translated `aria-label`s, and the pill fits
  at 390 px without horizontal overflow.
- **Status line** — the demo status texts (card position, zoom, reset, selected tool) are also
  translated, via `demo.status.*` keys with `{label}`, `{column}`, `{row}` and `{percent}`
  placeholders; switching the language clears the status line so no mixed-language sentence stays on
  screen.

## Cache-busted preview assets (P0-27)

A changed preview must never be rendered with cached CSS or JavaScript — the owner once saw the new
P0-26 markup with the old stylesheet and a broken-looking demo. The preview therefore ships its
assets with a version query:

```html
<link rel="stylesheet" href="../../../packages/ui-kit/tokens.css?v=P0-40" />
<link rel="stylesheet" href="preview.css?v=P0-40" />
<script src="preview.js?v=P0-40" defer></script>
```

- **Bump rule:** every task that changes a file in `apps/web/preview/` — or the shared
  `packages/ui-kit/tokens.css` it links — bumps the `?v=` value on the three links above to its task
  id in the same task (so a commit always has one version). The browser then requests a URL it has
  never cached and gets the current files, which also covers a changed design system that would
  otherwise be served from the cached token stylesheet.
- The locale files reuse the script's version automatically: `preview.js` reads the `v` query of its
  own script URL and appends it to the locale request (`locales/de.json?v=P0-40`), so one bump
  covers the translations as well.
- The icon SVGs are referenced from `preview.css` and keep stable, unversioned URLs; they only
  change with a design-system task, and every such task bumps the preview version anyway.
- The version query fixes the case the owner hit — new markup with an old cached stylesheet or
  script. It does not fix an already cached `index.html`: if the HTML document itself comes from the
  cache, the browser keeps the old markup and the old `?v=` values, so a hard reload is needed once.
  After that the new `?v=` URLs are fetched normally.

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
| `preview.js` | The dependency-free pointer and keyboard demo, the toolbar selection state and the DE/EN locale controller. |
| `locales/en.json` | English strings and translated attributes for the whole page. |
| `locales/de.json` | German strings and translated attributes, same key set as `en.json`. |
| `assets/demo-zone-image.webp` | The single owner-supplied demo photo in the static zone. |
| `README.md` | This file. |

## Serve locally

Serve the **repository root**, not this folder, so the relative token and icon paths resolve. Read
the slot's `web` port from `.polier-slot` (never hard-code it), then:

```sh
cd "/Users/rasulatashev/Desktop/KI Projekte/Project air-P0-40"
PORT=$(python3 -c "import json; print(json.load(open('.polier-slot'))['ports']['web'])")
python3 -m http.server "$PORT" --bind 127.0.0.1
```

Open `http://127.0.0.1:<port>/apps/web/preview/` in a browser. The page must be served over HTTP for
the DE/EN switch: `fetch` cannot read the locale files from `file://`, so a page opened from disk
stays on the English fallback (`<html lang="en">`, the switch still shows both options). Check it
with:

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
`P1-07-contract.png` (1440 wide, the contract overview section),
`P0-26-desktop.png` (1440×900, the demo with the toolbar, the zone and the refreshed masthead),
`P0-26-mobile.png` (390×844, top with the refreshed masthead),
`P0-26-mobile-demo.png` (390 wide, taller capture that shows the wrapped toolbar and the zone),
`P0-26-mid-768.png` (768×900, the compact layout at a mid width),
`P0-26-toolbar-states.png` (1440×900, tool hover, focus, pressed and selected states with tooltips),
`P0-27-desktop-en.png` / `P0-27-desktop-de.png` (1440×900, English and German, scrolled so the
whole demo surface with both cards and the photo is visible),
`P0-27-mobile-en.png` / `P0-27-mobile-de.png` (390×844, English and German) and
`P0-27-1426x583-de.png` (1426 × 583 CSS px at DPR 2, German, the owner's viewport with fresh CSS),
`P0-28-docked.png` (1440×900, both zone items docked),
`P0-28-mid-detach.png` (1440×900, the notepad at about 50 % detach progress),
`P0-28-detached.png` (1440×900, both items free on the canvas, no edge),
`P0-28-redocked.png` (1440×900, both items back in their slots),
`P0-29-zone-fading.png` (1440×900, the empty zone at ~57 % of its 180 ms fade-out),
`P0-29-overlap.png` (1440×900, the two free items overlapping below the 25 % grouping threshold),
`P0-29-grouped.png` (1440×900, the new zone with both items docked side by side),
`P0-29-zoom.png` (1440×900, the smaller zoom pill),
`P0-29-zoom-mobile.png` (390×844, scrolled so the smaller pill is inside the capture),
`P0-29-grouped-mobile.png` (390×844, a grouped zone re-fitted after resizing from 1440: vertical,
both items visible) and
`P0-29-grouped-toolbar.png` (1440×900, a grouped zone near the top clamped below the floating
toolbar),
`P0-30-horizontal.png` (1440×900, a zone grouped side by side from a horizontal drop),
`P0-30-vertical.png` (1440×900, a zone grouped stacked from a vertical drop),
`P0-30-swapped.png` (1440×900, the two docked items reordered/swapped inside the zone),
`P0-30-drop-hint.png` (1440×900, the subtle drop outline on the target while a free item is dragged
over it, before any commit),
`P0-30-controls.png` (1440×900, the smaller zoom pill),
`P0-30-controls-mobile.png` (390×844, the smaller pill on mobile),
`P0-30-masthead-en.png` / `P0-30-masthead-de.png` (1440×900, the rendered masthead with the P0-30
line and tasks in English and German),
`P0-30-zoom-150.png` (1440×900, a grouped zone re-fitted inside the visible surface at 150 % zoom),
`P0-31-docked.png` (1440×900, the start state on the taller 480 px surface),
`P0-31-pull-out.png` (1440×900, the photo pulled out mid-drag, the frame shrunk around the notepad),
`P0-31-landing-slot.png` (1440×900, a free item over the zone: grown frame and dashed landing slot),
`P0-31-ghost.png` (1440×900, two free items about to group: dashed ghost frame),
`P0-31-emptying.png` (1440×900, the last item pulled out: dimmed dashed frame),
`P0-31-grouped.png` (1440×900, the committed new zone),
`P0-31-mobile.png` (390×844, the start state on mobile),
`P0-32-named.png` (1440×900, the zone with its name in the header),
`P0-32-editing.png` (1440×900, renaming inline),
`P0-32-renamed.png` (1440×900, the committed new name),
`P0-32-long-name.png` (1440×900, a 40-character name with ellipsis),
`P0-32-ghost.png` / `P0-32-new-zone.png` (1440×900, grouping preview and the new zone named
“Neue Zone”),
`P0-32-mobile.png` (390×844, the named zone on mobile),
`P0-33-desktop.png` / `P0-33-desktop-de.png` (1440×900, checklist and table card in EN and DE),
`P0-33-interaction.png` (1440×900, an item ticked, a cell selected, the card dragged),
`P0-33-mobile.png` (390×844, the stacked compact layout),
`P0-34-moving.png` / `P0-34-moved.png` (1440×900, a zone mid-move and after the release),
`P0-34-mobile.png` (390×844, a zone moved upwards),
`P0-35-contract.png`, `P0-35-motion-layers.png`, `P0-35-chrome.png`, `P0-35-chrome-de.png`
(1440×900) and `P0-35-chrome-mobile.png` (390×844),
`P0-36-docked-resize.png`, `P0-36-free-photo.png`, `P0-36-photo-adopted.png`,
`P0-36-zoom-selection.png` (1440×900),
`P0-37-snap.png`, `P0-37-undo-hint.png`, `P0-37-highlight.png`, `P0-37-band.png`,
`P0-37-count-bar.png`, `P0-37-menu.png`, `P0-37-zone-delete.png` (1440×900),
`P0-38-layers.png`, `P0-38-edge-below-zone.png` (1440×900),
`P0-39-frame-rest.png`, `P0-39-frame-edge.png`, `P0-39-frame-edge-zoom.png`, `P0-39-frame-corner.png`,
`P0-39-frame-corner-zoom.png`, `P0-39-checklist.png`,
`P0-39-rules.png`, `P0-39-rules-de.png` (1440×900) and `P0-39-rules-mobile.png` (390×844),
`P0-40-team.png`, `P0-40-team-zoom.png`, `P0-40-team-idle.png`, `P0-40-team-de.png` (1440×900) and
`P0-40-team-mobile.png` (390×844) and the
`P0-19-preview.log` / `P0-20-preview.log` / `P0-21-preview.log` / `P0-22-preview.log` /
`P0-23-preview.log` / `P0-24-preview.log` / `P0-25-preview.log` / `P0-26-preview.log` /
`P0-27-preview.log` / `P0-28-preview.log` / `P0-29-preview.log` / `P0-30-preview.log` /
`P0-31-preview.log` / `P0-32-preview.log` / `P0-33-preview.log` / `P0-34-preview.log` / `P0-35-preview.log` / `P0-36-preview.log` / `P0-37-preview.log` / `P0-38-preview.log` / `P0-39-preview.log` / `P0-40-preview.log` /
`P1-07-preview.log` files with the
exact serve, curl and screenshot commands. The page has no horizontal overflow at 1440×900, 390×844
or the owner's 1426 × 583 viewport.
