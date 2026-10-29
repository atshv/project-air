// P6-07 (L04): pure panel open/close state and the transient camera pan.
//
// The panel is an overlay: the canvas width never changes. Opening the panel may
// shift the view once (300 ms) so a selected card that would sit under the panel
// stands 24 px left of it; the shift is transient and is never persisted (L17
// stores only user camera input).

import type { EngineCamera } from "../../../../packages/engine/src/bridge/engine.ts";

/** Panel width of the L04 target value. */
export const PANEL_WIDTH = 400;
/** Gap to the top, right and bottom canvas edge. */
export const PANEL_GAP = 12;
/** Panel show/hide motion. */
export const PANEL_MOTION_MS = 180;
/** Transient camera pan motion when the selected card would be hidden. */
export const PANEL_PAN_MS = 300;
/** Clearance kept between the card's right edge and the panel. */
export const PANEL_PAN_CLEARANCE = 24;
/** Closed/closing off-screen shift (translateX). */
export const PANEL_OPEN_SHIFT = 16;
/** At and below this viewport width the panel uses the full width (390 px target). */
export const PANEL_FULL_WIDTH_VIEWPORT = 430;

export type PanelPhase = "closed" | "opening" | "open" | "closing";
export type PanelEvent = "open" | "opened" | "close" | "closed";

export function panelWidthFor(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return PANEL_WIDTH;
  return Math.round(Math.min(PANEL_WIDTH, viewportWidth));
}

/** Screen x of the panel's left edge; 0 for the full-width mobile panel. */
export function panelLeftFor(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  if (viewportWidth <= PANEL_FULL_WIDTH_VIEWPORT) return 0;
  return Math.max(0, viewportWidth - PANEL_GAP - panelWidthFor(viewportWidth));
}

/** L04 state machine: closed -> opening -> open -> closing -> closed. */
export function panelPhaseAfter(phase: PanelPhase, event: PanelEvent): PanelPhase {
  switch (phase) {
    case "closed":
      return event === "open" ? "opening" : "closed";
    case "opening":
      if (event === "opened") return "open";
      return event === "close" ? "closing" : "opening";
    case "open":
      return event === "close" ? "closing" : "open";
    case "closing":
      if (event === "closed") return "closed";
      return event === "open" ? "opening" : "closing";
  }
}

export function panelIsVisible(phase: PanelPhase): boolean {
  return phase !== "closed";
}

export interface PanelCameraInput {
  readonly camera: EngineCamera;
  readonly card: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly viewportWidth: number;
}

/**
 * The one transient pan that keeps the selected card 24 px left of the panel.
 * Returns `null` when the card is already clear of the panel (no view change).
 */
export function panelCameraForCard(input: PanelCameraInput): EngineCamera | null {
  const { camera, card } = input;
  if (!Number.isFinite(camera.panX) || !Number.isFinite(camera.zoom) || camera.zoom <= 0) return null;
  // At the mobile full-width panel there is no 24 px strip left of the panel;
  // the overlay covers the canvas and the view is not panned (L04 target).
  if (!(input.viewportWidth > PANEL_FULL_WIDTH_VIEWPORT)) return null;
  const panelLeft = panelLeftFor(input.viewportWidth);
  const cardLeft = (card.x - camera.panX) * camera.zoom;
  const cardRight = cardLeft + card.width * camera.zoom;
  const targetRight = panelLeft - PANEL_PAN_CLEARANCE;
  if (cardRight <= targetRight) return null;
  const shift = cardRight - targetRight;
  return { panX: camera.panX + shift / camera.zoom, panY: camera.panY, zoom: camera.zoom };
}

/** Reduced-motion or instant mode keeps the target camera without the animation. */
export function panelPanDuration(reducedMotion: boolean): number {
  return reducedMotion ? 0 : PANEL_PAN_MS;
}
