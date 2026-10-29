// The engine surface for an app (P6-14).
//
// One module an app imports to wire the canvas the way the playground does:
// the bridge (`createEngine`, hit testing, snapping, text binding), pointer input
// with drag/resize/auto-pan/wheel (L03, L14, L15, L16), placement (L20), the
// field overlay and inline keys (L18), zone parity and lifecycle (L08), the
// keyboard map and context menu model (L12) and view persistence (L17). The
// logic layer (operations, document port, history, gestures) stays in
// `src/logic/` and is imported from there; docs/engine.md "Using the engine from
// an app" lists what the app wires itself.

import type { Engine, EngineObjectText } from "./engine.js";

export * from "./engine.js";
export * from "./input.js";
export * from "./placement.js";
export * from "./overlay.js";
export * from "./zone-parity.js";
export * from "./zone-lifecycle.js";
export * from "./keyboard.js";
export * from "./view-persistence.js";

/**
 * Binds a block's title and content preview (L02) and returns the height the
 * block needs so the preview is not clipped, never below `minimumHeight` (the
 * contract minimum of its type). The caller writes the height with a resize
 * operation or `updateGeometry`; the block grows instead of scrolling (L18).
 * Build the preview with `blockContentPreview` from `src/logic/operations.ts`.
 */
export function fitBlockToContent(
  engine: Pick<Engine, "bindObjectText" | "requiredTextHeight">,
  slot: number,
  text: EngineObjectText,
  minimumHeight: number,
): number {
  engine.bindObjectText(slot, text);
  const preview = text.preview ?? "";
  if (preview === "") {
    return minimumHeight;
  }
  return Math.max(minimumHeight, Math.ceil(engine.requiredTextHeight(slot)));
}
