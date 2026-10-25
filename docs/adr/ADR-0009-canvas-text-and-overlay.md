# ADR-0009: Canvas text and overlay strategy

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

Engine-core renders board content (cards, zones, blocks, chrome, selection and guides) in
`packages/engine`, and the canvas-catalogue entries L02, L03 and L18 require readable card titles and
previews, a field-editing path and inline keyboard comfort. Two constraints decide the technique:
visual values come only from `packages/ui-kit/tokens.json` (AD-7), whose font tokens are CSS system
font stacks (`ui-sans-serif, system-ui, …`, `"Source Serif 4", Georgia, serif`), and the licence list
allows only MIT, BSD, Apache-2.0, ISC and Zlib — common UI font files are OFL and therefore cannot be
bundled. Rendering every card as a DOM node does not survive the 10,000-object target, while pure
canvas text would need a bundled font or a text-shaping dependency.

## Decision

We use a hybrid presentation:

- **Engine (C++/WASM):** geometry quads plus card titles and previews. Text goes through a runtime
  glyph atlas: the TypeScript bridge rasterises glyphs with Canvas2D/OffscreenCanvas using the font
  stack and typography values from the tokens, uploads the RGBA atlas and glyph metrics to C++, and
  the renderer draws textured glyph quads from the same command-buffer path as rectangles. No font
  file is committed; the atlas is rebuilt when the device pixel ratio or zoom bucket changes, and a
  missing glyph falls back to a visible placeholder instead of silently disappearing.
- **DOM overlay:** field editing (L18), the toolbar, side panel, context menu, hints, dialogs and
  future a11y mirror live in a thin DOM layer above the canvas, positioned from the camera transform.
  The overlay owns no board state: every edit goes through the same gesture-to-operation seam as the
  canvas, and fields never start a drag (L03).
- **Images:** not part of engine-core (owner Q20). When media arrives, images use the same engine
  quad path with detail levels, decided together with `services/media`.

## Consequences

- **Positive:** no font licence risk and no bundled binary; text uses the same system rendering as
  the DOM and stays crisp at the device pixel ratio; titles and previews scale and cull with the
  canvas instead of becoming thousands of DOM nodes; the overlay can be accessible with normal HTML
  while the canvas stays a single instanced draw.
- **Negative:** the bridge owns rasterisation (a one-time cost per glyph plus atlas uploads); two
  rendering worlds must agree on typography, colour and positions; extreme zoom needs atlas
  re-rasterisation to stay crisp; the a11y/test mirror is deferred (Q20), so canvas content is not
  yet reachable by screen readers.
- **Binds:** `packages/engine` (bridge and renderer), `apps/engine-playground` and later `apps/web`
  and `packages/editor`; L02 text, L03 field-drag rule, L18 overlay.
- **Prevents:** a bundled OFL font, per-frame Canvas2D text drawing, one DOM node per board object,
  and network access inside the engine.

## Alternatives

- **Bundle an OFL font** — rejected: the licence list does not include OFL; a recorded owner exception
  would be needed and the artifact grows.
- **Rasterise glyphs in C++ (stb_truetype or similar)** — rejected: a new dependency and a second font
  source, while the browser already owns system-font rendering.
- **DOM-only text for cards** — rejected: 10,000 objects at 60 fps is unreachable with tens of
  thousands of DOM nodes, and canvas zoom/selection state would diverge.
- **Canvas2D overlay above the WebGL canvas** — rejected: per-frame CPU text drawing, no batching and
  a second drawing path next to the command buffer.
