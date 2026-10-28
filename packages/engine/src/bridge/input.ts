// Pointer input layer of the engine bridge (L03 / P4-14): click, drag and edit
// are separated by one state machine, and the playground binds the DOM events to
// it instead of keeping its own pointer handlers.
//
// The layer is DOM-free (it runs in Node tests as well): the playground supplies
// the hit test, the camera/view callbacks, the drag preview and the seam that
// commits a completed drag. Every number is passed in from the caller, so the
// values stay the generated tokens (design rule §13, AD-7): 4 px
// `drag-threshold`, 40 px `header-height`, 120 ms `motion-hover`.
//
// Rules (canvas catalogue L03, design rules §6/§7):
// - a press that moves less than the threshold is a click: no drag starts and no
//   position operation is written;
// - a note card drags on its whole body; a block or zone only on the 40 px
//   header band, its body below the band moves nothing;
// - a press in a field, button, select, editable or scrollable target never
//   starts a drag and keeps its own pointer/wheel handling;
// - right-button and non-primary (multi-touch) presses never drag; a second
//   pointer cancels a running drag and becomes the two-pointer pinch zoom;
// - pointer capture is released on up, cancel, lost capture and blur, and a
//   cancelled drag is reverted without a write;
// - the cursors are `grab` on a grip, `grabbing` while dragging, `text` on
//   editable targets and `default` elsewhere; the header hover surface is
//   presentation state (ADR-0009) and never document state.
//
// The seam functions (`buildOperation`, `applyOperation`, `history.push`) live in
// the logic layer; the playground injects them through `InputHost.commitDrag`
// (module-map: UI → logic → data, so this bridge module has no runtime import of
// `src/logic/`). The unit suite wires the real seam to prove one drag is exactly
// one operation with its inverse.

/** Kind of a board object the pointer can grab (design-rules layers). */
export type InputTargetKind = "card" | "zone" | "block";

/** Cursor values of L03/design rule §6. */
export type InputCursor =
  | "default"
  | "grab"
  | "grabbing"
  | "text"
  | "ns-resize"
  | "ew-resize"
  | "nwse-resize"
  | "nesw-resize";

/** Screen (CSS) point relative to the canvas. */
export interface InputScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** World point in the contract's pixels. */
export interface InputWorldPoint {
  readonly x: number;
  readonly y: number;
}

/** World rectangle of one board object, as the input layer needs it. */
export interface InputTargetBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** World rectangle (rubber band and world-space intersection rule, L10). */
export interface InputWorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One member of a joint drag (L10): the target captured when the drag started and
 * the world position it should preview/commit.
 */
export interface InputDragMember {
  readonly target: InputTarget;
  readonly position: InputWorldPoint;
}

/** L10 (P4-16): world-space intersect rule of the rubber band (bounds intersection,
 * not containment). Touching edges count as intersecting, like the engine's
 * inclusive bounds rule. */
export function worldRectsIntersect(left: InputWorldRect, right: InputWorldRect): boolean {
  return (
    left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height
  );
}

/** One board object under the pointer. */
export interface InputTarget {
  readonly kind: InputTargetKind;
  /** Stable contract id (the operation target); presentation-only scenes may use a scene id. */
  readonly id: string;
  /** Engine document slot, for the caller's drag preview. */
  readonly slot: number;
  readonly world: InputTargetBounds;
  /** False for presentation-only scenes (the titles gallery), which pan instead of dragging. */
  readonly draggable: boolean;
}

/** One pointer event, reduced to what the state machine needs. */
export interface PointerSample {
  readonly pointerId: number;
  /** `mouse`, `touch` or `pen` (`PointerEvent.pointerType`). */
  readonly pointerType: string;
  /** Mouse button on a press; touch and pen report 0. */
  readonly button: number;
  readonly screen: InputScreenPoint;
  /** True when the press target is a field/scrollable chrome element (suppression policy). */
  readonly suppressed?: boolean;
  /** True when the suppressed target is an editable field (`text` cursor). */
  readonly editable?: boolean;
  /** Shift: L07 frees the snapped position (no line, no grid, no guide). */
  readonly shiftKey?: boolean;
}

/** Hover presentation state the playground applies as DOM chrome. */
export interface InputHover {
  readonly target: InputTarget | null;
  /** Pointer over a draggable grip (card body or block/zone header). */
  readonly grip: boolean;
  /** Pointer over a block/zone header band: the `--faint` hover surface applies. */
  readonly header: boolean;
  readonly cursor: InputCursor;
  readonly screen: InputScreenPoint;
}

/** Callbacks the playground implements over the DOM and the camera. */
export interface InputHost {
  /** The object under the screen point, or null for the empty canvas. */
  hitTest(screenX: number, screenY: number): InputTarget | null;
  /** Camera transform of a screen point (for the grip offset and 1:1 follow). */
  screenToWorld(screenX: number, screenY: number): InputWorldPoint;
  /** View-only pan: move the camera by a screen delta. */
  panByScreen(deltaX: number, deltaY: number): void;
  /** View-only zoom: multiply the camera zoom and keep the screen point fixed. */
  zoomByFactor(factor: number, screenX: number, screenY: number): void;
  /** Move the object visually while the drag is in progress (no document write). */
  previewDrag(target: InputTarget, position: InputWorldPoint): void;
  /** Commit the drag as one `drag-single` gesture through the operation seam. */
  commitDrag(target: InputTarget, position: InputWorldPoint): void;
  /** Restore the object after a cancelled drag (no operation, no history entry). */
  revertDrag(target: InputTarget): void;
  /**
   * L07 (P4-15): snap the dragged world position. Called on every drag move with
   * the Shift state; `free` returns the position unchanged. The returned position
   * is previewed and committed. Optional for hosts without a snapping core.
   */
  snapDrag?(target: InputTarget, position: InputWorldPoint, free: boolean): InputWorldPoint;
  /** Clears the guides after a drag ends or is cancelled. */
  clearSnap?(): void;
  /** L10: the current geometry of the selected objects (joint drag and count bar). */
  selectionTargets?(): readonly InputTarget[];
  /** L10: the live objects whose bounds intersect the world rect (rubber band). */
  targetsInRect?(rect: InputWorldRect): readonly InputTarget[];
  /** L10: preview a joint drag (no document write). */
  previewGroupDrag?(members: readonly InputDragMember[]): void;
  /** P4-29: reports every primary drag move (target + snapped world position). */
  onDragMove?(target: InputTarget, position: InputWorldPoint): void;
  /** L10: commit a joint drag as exactly one drag-group gesture. */
  commitGroupDrag?(members: readonly InputDragMember[]): void;
  /** L10: restore every member after a cancelled joint drag. */
  revertGroupDrag?(members: readonly InputDragMember[]): void;
  /** L10: the selection changed (native chrome and the DOM count bar). */
  onSelectionChange?(targets: readonly InputTarget[]): void;
  /** L10: the live rubber band in world px, or null when it disappears. */
  onBandChange?(band: InputWorldRect | null): void;
  /**
   * P4-17 (L14): project a world point to canvas-relative screen px (the inverse
   * of `screenToWorld`), used for the handle hit area.
   */
  worldToScreen?(world: InputWorldPoint): InputScreenPoint;
  /** P4-17: preview a resize through the bridge geometry update (no write). */
  previewResize?(target: InputTarget, rect: InputWorldRect): void;
  /** P4-17: commit exactly one resize gesture through the seam. */
  commitResize?(target: InputTarget, rect: InputWorldRect): void;
  /** P4-17: restore the committed geometry after a cancelled resize. */
  revertResize?(target: InputTarget): void;
  /** P4-17: the clamped minimum of one target (per type and, for a zone, members). */
  resizeMinimum?(target: InputTarget): { readonly width: number; readonly height: number };
  /** A press below the threshold was released: a click, and no position write. */
  onTap(target: InputTarget | null, screen: InputScreenPoint): void;
  /** Hover presentation changed (grip, header band and cursor). */
  onHover(state: InputHover): void;
  /** Effective cursor changed. */
  onCursor(cursor: InputCursor): void;
  capturePointer(pointerId: number): void;
  releasePointer(pointerId: number): void;
}

/** Constructor options; the numbers come from the generated tokens. */
export interface PointerInputOptions {
  /** `tokens::drag_threshold` in screen px (4 px). */
  readonly thresholdPx: number;
  /** `tokens::header_height` in world px (40 px), the block/zone grip band. */
  readonly headerHeightPx: number;
  /** `tokens::motion_hover` in ms (120 ms), the hover surface transition. */
  readonly hoverTransitionMs: number;
  readonly host: InputHost;
}

/** Wheel delta modes of a DOM `WheelEvent` (kept numeric so the layer stays DOM-free). */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_TO_PX = 16;
const WHEEL_PAGE_TO_PX = 100;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/** True when a screen movement reaches the token threshold (a drag, not a click). */
export function crossesDragThreshold(
  deltaX: number,
  deltaY: number,
  thresholdPx: number,
): boolean {
  const distance = Math.hypot(deltaX, deltaY);
  return Number.isFinite(distance) && distance >= thresholdPx;
}

/**
 * Grip policy: a note card drags on its whole rectangle; a block or a zone only
 * in its `headerHeightPx` header band (the pointer's local world y from the
 * object's top). A pointer above or below the band is not a grip.
 */
export function isGrip(
  kind: InputTargetKind,
  localWorldY: number,
  headerHeightPx: number,
): boolean {
  if (kind === "card") {
    return true;
  }
  return Number.isFinite(localWorldY) && Number.isFinite(headerHeightPx) &&
    localWorldY >= 0 && localWorldY <= headerHeightPx;
}

// P4-17 (L14): resize handles, anchor math, 16 px snap and the minima.
// The handle hit area and the handle size are the same 8 screen px (documented
// next to the other interaction constants); the grid is tokens::canvas_grid
// (16 world px) and the per-type minima mirror the logic layer's resize seam.

/** Handle size and hit area in screen px (L14 interaction value: 8 px). */
export const RESIZE_HANDLE_PX = 8;
/** Size snap in world px (tokens::canvas_grid). */
export const RESIZE_GRID_PX = 16;
/** Zone content inset in world px (tokens::space_16, P4-27 rule). */
export const RESIZE_ZONE_INSET_PX = 16;

/** The eight handles: four corners and four edge midpoints. */
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Per-type minimum sizes, mirroring the logic layer's resize minima. */
export const RESIZE_MINIMA = {
  card: { width: 176, height: 80 },
  zone: { width: 256, height: 192 },
  block: {
    checklist: { width: 224, height: 128 },
    palette: { width: 224, height: 128 },
    columns: { width: 368, height: 192 },
    timeline: { width: 320, height: 160 },
    table: { width: 288, height: 160 },
  },
} as const;

export type InputBlockType = "checklist" | "palette" | "columns" | "timeline" | "table";

/** Minimum size of one resize target; a zone also keeps its member extent + 16 px. */
export function resizeMinimumFor(
  kind: "card" | "block" | "zone",
  blockType: InputBlockType = "checklist",
  memberRects: readonly InputWorldRect[] = [],
): { readonly width: number; readonly height: number } {
  const type = kind === "zone" ? RESIZE_MINIMA.zone : kind === "card" ? RESIZE_MINIMA.card : RESIZE_MINIMA.block[blockType];
  if (kind !== "zone" || memberRects.length === 0) {
    return { width: type.width, height: type.height };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const member of memberRects) {
    left = Math.min(left, member.x);
    top = Math.min(top, member.y);
    right = Math.max(right, member.x + member.width);
    bottom = Math.max(bottom, member.y + member.height);
  }
  return {
    width: Math.max(type.width, right - left + RESIZE_ZONE_INSET_PX),
    height: Math.max(type.height, bottom - top + RESIZE_ZONE_INSET_PX),
  };
}

/** World positions of the eight handles of one rectangle. */
export function resizeHandlePositions(
  rect: InputWorldRect,
): { readonly handle: ResizeHandle; readonly x: number; readonly y: number }[] {
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return [
    { handle: "nw", x: rect.x, y: rect.y },
    { handle: "n", x: midX, y: rect.y },
    { handle: "ne", x: right, y: rect.y },
    { handle: "e", x: right, y: midY },
    { handle: "se", x: right, y: bottom },
    { handle: "s", x: midX, y: bottom },
    { handle: "sw", x: rect.x, y: bottom },
    { handle: "w", x: rect.x, y: midY },
  ];
}

/**
 * The handle under a screen point: nearest handle centre within the 8 screen px
 * hit area (zoom-independent). Corners win ties because they are tested first.
 */
export function resizeHandleAt(
  screen: InputScreenPoint,
  rect: InputWorldRect,
  worldToScreen: (world: InputWorldPoint) => InputScreenPoint,
  hitPx = RESIZE_HANDLE_PX,
): ResizeHandle | null {
  let best: ResizeHandle | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const position of resizeHandlePositions(rect)) {
    const projected = worldToScreen({ x: position.x, y: position.y });
    const dx = Math.abs(screen.x - projected.x);
    const dy = Math.abs(screen.y - projected.y);
    if (dx <= hitPx && dy <= hitPx) {
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = position.handle;
      }
    }
  }
  return best;
}

/** Cursor of a handle (`nwse` on the NW/SE diagonal, `nesw` on NE/SW). */
export function resizeCursor(handle: ResizeHandle): InputCursor {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
  }
}

/** Which rectangle edges the handle moves and which stay anchored. */
export function resizeAnchor(handle: ResizeHandle): {
  readonly horizontal: "left" | "right" | null;
  readonly vertical: "top" | "bottom" | null;
} {
  return {
    horizontal: handle.includes("w") ? "right" : handle.includes("e") ? "left" : null,
    vertical: handle.includes("n") ? "bottom" : handle.includes("s") ? "top" : null,
  };
}

function snapDimension(value: number, grid: number): number {
  if (!Number.isFinite(value) || !(grid > 0)) {
    return value;
  }
  return Math.round(value / grid) * grid;
}

/**
 * New rectangle for a handle drag: the opposite edge/corner stays anchored; the
 * resulting width/height snaps to the 16 px grid unless `free`, then clamps at
 * the minimum (which also keeps the anchored edge fixed).
 */
export function resizeFromPointer(input: {
  readonly handle: ResizeHandle;
  readonly rect: InputWorldRect;
  readonly pointer: InputWorldPoint;
  readonly snap: boolean;
  readonly minimum: { readonly width: number; readonly height: number };
  readonly gridPx?: number;
}): InputWorldRect {
  const grid = input.gridPx ?? RESIZE_GRID_PX;
  const right = input.rect.x + input.rect.width;
  const bottom = input.rect.y + input.rect.height;
  let left = input.rect.x;
  let top = input.rect.y;
  let width = input.rect.width;
  let height = input.rect.height;
  const movesWest = input.handle.includes("w");
  const movesEast = input.handle.includes("e");
  const movesNorth = input.handle.includes("n");
  const movesSouth = input.handle.includes("s");
  if (movesWest) {
    width = right - input.pointer.x;
    if (input.snap) width = snapDimension(width, grid);
    width = Math.max(width, input.minimum.width);
    left = right - width;
  } else if (movesEast) {
    width = input.pointer.x - left;
    if (input.snap) width = snapDimension(width, grid);
    width = Math.max(width, input.minimum.width);
  }
  if (movesNorth) {
    height = bottom - input.pointer.y;
    if (input.snap) height = snapDimension(height, grid);
    height = Math.max(height, input.minimum.height);
    top = bottom - height;
  } else if (movesSouth) {
    height = input.pointer.y - top;
    if (input.snap) height = snapDimension(height, grid);
    height = Math.max(height, input.minimum.height);
  }
  return { x: left, y: top, width, height };
}

/** Screen descriptor of the DOM target, used for the suppression policy. */
export interface SuppressionDescriptor {
  readonly tagName: string;
  readonly contentEditable?: boolean;
  readonly dataField?: boolean;
  readonly overflowX?: string;
  readonly overflowY?: string;
}

const SUPPRESSED_TAG_NAMES = new Set(["input", "textarea", "select", "button"]);
const SCROLLING_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

/** True when a press on this target must not start a drag (L03 suppression). */
export function isSuppressedTarget(descriptor: SuppressionDescriptor): boolean {
  const tag = descriptor.tagName.toLowerCase();
  if (SUPPRESSED_TAG_NAMES.has(tag) || descriptor.dataField === true) {
    return true;
  }
  if (descriptor.contentEditable === true) {
    return true;
  }
  const overflowX = (descriptor.overflowX ?? "").toLowerCase();
  const overflowY = (descriptor.overflowY ?? "").toLowerCase();
  return SCROLLING_OVERFLOW.has(overflowX) || SCROLLING_OVERFLOW.has(overflowY);
}

/** Cursor of a suppressed target: editable fields use `text`, chrome uses `default`. */
export function cursorForSuppressed(descriptor: SuppressionDescriptor): InputCursor {
  const tag = descriptor.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || descriptor.contentEditable === true) {
    return "text";
  }
  return "default";
}

/** Effective cursor of one pointer state (design rule §6). */
export function cursorFor(state: {
  readonly dragging?: boolean;
  readonly grip?: boolean;
  readonly suppressed?: boolean;
  readonly editable?: boolean;
}): InputCursor {
  if (state.suppressed === true) {
    return state.editable === true ? "text" : "default";
  }
  if (state.dragging === true) {
    return "grabbing";
  }
  return state.grip === true ? "grab" : "default";
}

/** Normalises a wheel delta to pixels (mice, trackpads and page-mode wheels). */
export function normaliseWheelDelta(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) {
    return 0;
  }
  if (deltaMode === DOM_DELTA_LINE) {
    return deltaY * WHEEL_LINE_TO_PX;
  }
  if (deltaMode === DOM_DELTA_PAGE) {
    return deltaY * WHEEL_PAGE_TO_PX;
  }
  return deltaY;
}

/** Zoom factor of a normalised pixel delta (negative scroll zooms in). */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  return Math.exp(-normaliseWheelDelta(deltaY, deltaMode) * WHEEL_ZOOM_SENSITIVITY);
}

type Phase = "idle" | "pressed" | "dragging" | "resizing" | "panning" | "pinch" | "blocked" | "band";

interface PinchState {
  readonly distance: number;
  readonly mid: InputScreenPoint;
}

const distanceOf = (left: InputScreenPoint, right: InputScreenPoint): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

const midpointOf = (left: InputScreenPoint, right: InputScreenPoint): InputScreenPoint => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});

/**
 * One pointer state machine: click vs drag, grip policy, suppression, capture,
 * cancel and the two-pointer pinch. All DOM work happens through `InputHost`.
 */
export class PointerInput {
  readonly #options: PointerInputOptions;
  readonly #host: InputHost;
  readonly #pointers = new Map<number, InputScreenPoint>();
  #phase: Phase = "idle";
  #primaryPointer: number | null = null;
  #downScreen: InputScreenPoint | null = null;
  #lastScreen: InputScreenPoint | null = null;
  #target: InputTarget | null = null;
  #grabOffset: InputWorldPoint | null = null;
  #snappedPosition: InputWorldPoint | null = null;
  #pinch: PinchState | null = null;
  #hover: InputHover | null = null;
  #cursor: InputCursor = "default";
  // L10 (P4-16) selection and joint-drag state. Presentation state only: never
  // document state, never an operation payload field.
  #selection: InputTarget[] = [];
  #pendingToggle = false;
  #bandCandidate = false;
  #band: { readonly start: InputScreenPoint; rect: InputWorldRect } | null = null;
  #group: InputTarget[] | null = null;
  #groupAnchor: InputTarget | null = null;
  #groupMembers: InputDragMember[] | null = null;
  // P4-17 (L14) resize state: presentation-only preview of one selected object.
  #resize: {
    readonly target: InputTarget;
    readonly handle: ResizeHandle;
    last: InputWorldRect;
  } | null = null;

  constructor(options: PointerInputOptions) {
    if (!Number.isFinite(options.thresholdPx) || options.thresholdPx < 0) {
      throw new RangeError("thresholdPx must be a finite, non-negative number");
    }
    if (!Number.isFinite(options.headerHeightPx) || options.headerHeightPx < 0) {
      throw new RangeError("headerHeightPx must be a finite, non-negative number");
    }
    if (!Number.isFinite(options.hoverTransitionMs) || options.hoverTransitionMs < 0) {
      throw new RangeError("hoverTransitionMs must be a finite, non-negative number");
    }
    this.#options = options;
    this.#host = options.host;
  }

  /** Current phase, for the playground's HUD/evidence and the tests. */
  get phase(): Phase {
    return this.#phase;
  }

  get hover(): InputHover | null {
    return this.#hover;
  }

  /** L10: the current selection, in selection order. */
  get selection(): readonly InputTarget[] {
    return this.#selection;
  }

  /** L10: true while `id` is part of the selection. */
  isSelected(id: string): boolean {
    return this.#selection.some((target) => target.id === id);
  }

  /**
   * L10: key handling of the selection (the playground forwards `keydown`).
   * `Escape` clears a non-empty selection or a live band and returns true.
   */
  keyDown(key: string): boolean {
    if (key !== "Escape") {
      return false;
    }
    if (this.#phase === "resizing" && this.#resize !== null) {
      const state = this.#resize;
      this.#resize = null;
      this.#host.revertResize?.(state.target);
      this.#finish();
      return true;
    }
    if (this.#selection.length === 0 && this.#band === null) {
      return false;
    }
    this.clearSelection();
    this.#clearBand();
    return true;
  }

  /** L10: drops the selection and notifies the host (Esc, empty click, reload). */
  clearSelection(): void {
    this.#bandCandidate = false;
    if (this.#selection.length === 0) {
      return;
    }
    this.#selection = [];
    this.#host.onSelectionChange?.([]);
  }

  get cursor(): InputCursor {
    return this.#cursor;
  }

  /** The token threshold this instance enforces. */
  get thresholdPx(): number {
    return this.#options.thresholdPx;
  }

  /** The header band height this instance uses as the block/zone grip. */
  get headerHeightPx(): number {
    return this.#options.headerHeightPx;
  }

  /** The hover transition (motion token) the playground applies to the surface. */
  get hoverTransitionMs(): number {
    return this.#options.hoverTransitionMs;
  }

  pointerDown(sample: PointerSample): void {
    if (this.#pointers.has(sample.pointerId)) {
      return;
    }
    // Right/middle mouse buttons never drag or pan: context menus belong to L20.
    if (sample.pointerType === "mouse" && sample.button !== 0) {
      return;
    }
    this.#pointers.set(sample.pointerId, sample.screen);
    if (this.#pointers.size === 1) {
      this.#beginPrimary(sample);
      return;
    }
    // A second pointer is a pinch, never a second drag: a running object drag is
    // reverted first (a cancelled gesture writes nothing) and a live band ends.
    if (this.#phase === "dragging") {
      this.#cancelDrag();
    }
    this.#clearBand();
    this.#target = null;
    this.#beginPinch();
  }

  pointerMove(sample: PointerSample): void {
    if (!this.#pointers.has(sample.pointerId)) {
      return;
    }
    this.#pointers.set(sample.pointerId, sample.screen);
    if (this.#phase === "pinch") {
      this.#movePinch();
      return;
    }
    if (this.#pointers.size !== 1 || sample.pointerId !== this.#primaryPointer) {
      return;
    }
    this.#movePrimary(sample.screen, sample.shiftKey === true);
  }

  pointerUp(sample: PointerSample): void {
    if (!this.#pointers.has(sample.pointerId)) {
      return;
    }
    if (this.#phase === "band") {
      // L10: the rubber band selects every live object whose bounds intersect it
      // in world space, then disappears. The band is presentation-only.
      const band = this.#band;
      this.#clearBand();
      this.#finish();
      if (band !== null && this.#host.targetsInRect !== undefined) {
        this.#setSelection(this.#host.targetsInRect(band.rect));
      }
      return;
    }
    if (this.#phase === "resizing" && this.#resize !== null) {
      const state = this.#resize;
      const rect = state.last;
      const changed =
        rect.x !== state.target.world.x || rect.y !== state.target.world.y ||
        rect.width !== state.target.world.width || rect.height !== state.target.world.height;
      this.#resize = null;
      this.#setCursor("default");
      this.#finish();
      if (changed) {
        this.#host.commitResize?.(state.target, rect);
      }
      return;
    }
    if (this.#phase === "dragging" && this.#target !== null && this.#grabOffset !== null) {
      // L10: a joint drag commits exactly one drag-group gesture; the selection
      // survives the release. A single drag keeps the P4-14 path.
      if (this.#groupMembers !== null && this.#host.commitGroupDrag !== undefined) {
        const members = this.#groupMembers;
        this.#finish();
        this.#host.commitGroupDrag(members);
        this.#host.onSelectionChange?.(this.#host.selectionTargets?.() ?? this.#selection);
        return;
      }
      // Commit exactly the position the preview showed (the snapped one, or the
      // free pointer position while Shift was held at the last move).
      const position =
        this.#snappedPosition ?? this.#positionFor(sample.screen, this.#grabOffset);
      const target = this.#target;
      this.#finish();
      this.#host.commitDrag(target, position);
      return;
    }
    if (this.#phase === "pressed") {
      // Below the threshold: a click. It writes no position and no history.
      const target = this.#target;
      const shift = sample.shiftKey === true || this.#pendingToggle;
      this.#pendingToggle = false;
      this.#finish();
      if (target !== null && target.draggable) {
        if (shift) {
          this.#toggleSelection(target);
        } else {
          // A plain click replaces the selection with the clicked object.
          this.#setSelection([target]);
        }
      } else if (target === null && sample.shiftKey !== true) {
        // A plain click on the empty canvas clears the selection.
        this.clearSelection();
      }
      this.#host.onTap(target, sample.screen);
      return;
    }
    this.#finish();
  }

  /** `pointercancel`, `lostpointercapture` or a window blur: nothing is committed. */
  pointerCancel(pointerId: number): void {
    if (!this.#pointers.has(pointerId)) {
      return;
    }
    if (this.#phase === "dragging") {
      this.#cancelDrag();
    }
    if (this.#phase === "resizing" && this.#resize !== null) {
      const state = this.#resize;
      this.#resize = null;
      this.#host.revertResize?.(state.target);
      this.#setCursor("default");
    }
    this.#clearBand();
    this.#finish();
  }

  /** Cancels every pointer, e.g. on blur. A running drag is reverted, never written. */
  cancelAll(): void {
    if (this.#phase === "dragging") {
      this.#cancelDrag();
    }
    this.#clearBand();
    this.#finish();
    this.#clearHover();
  }

  /** Hover update for a pointer move without a pressed button. */
  pointerHover(sample: PointerSample): void {
    if (this.#pointers.size > 0) {
      return;
    }
    // P4-17: over a handle of a selected object the cursor becomes the resize
    // cursor (the handle chrome itself is drawn by the native chrome pass).
    if (
      this.#selection.length > 0 &&
      sample.suppressed !== true &&
      this.#host.worldToScreen !== undefined
    ) {
      const selected = this.#host.selectionTargets?.() ?? this.#selection;
      for (const candidate of selected) {
        const handle = resizeHandleAt(sample.screen, candidate.world, this.#host.worldToScreen);
        if (handle !== null) {
          const cursor = resizeCursor(handle);
          this.#setCursor(cursor);
          this.#host.onHover({ target: candidate, grip: false, header: false, cursor, screen: sample.screen });
          return;
        }
      }
    }
    const suppressed = sample.suppressed === true;
    const target = this.#host.hitTest(sample.screen.x, sample.screen.y);
    const localY = target === null ? 0 : this.#localWorldY(sample.screen, target);
    const grip = !suppressed && target !== null && target.draggable &&
      isGrip(target.kind, localY, this.#options.headerHeightPx);
    const header = !suppressed && target !== null && target.kind !== "card" &&
      isGrip(target.kind, localY, this.#options.headerHeightPx);
    const cursor = cursorFor({
      grip,
      suppressed,
      editable: sample.editable === true,
    });
    const hover: InputHover = { target, grip, header, cursor, screen: sample.screen };
    this.#hover = hover;
    this.#setCursor(cursor);
    this.#host.onHover(hover);
  }

  /** Pointer left the interactive surface: clear the hover chrome. */
  pointerLeave(): void {
    if (this.#pointers.size > 0) {
      return;
    }
    this.#clearHover();
  }

  /**
   * Wheel zoom. A suppressed target (a scrollable chrome element) keeps its own
   * wheel handling and returns false. Returns true when the view zoomed.
   */
  wheel(
    deltaY: number,
    deltaMode: number,
    screen: InputScreenPoint,
    suppressed: boolean,
  ): boolean {
    if (suppressed) {
      return false;
    }
    const factor = wheelZoomFactor(deltaY, deltaMode);
    if (!Number.isFinite(factor) || factor <= 0) {
      return false;
    }
    this.#host.zoomByFactor(factor, screen.x, screen.y);
    return true;
  }

  #beginPrimary(sample: PointerSample): void {
    this.#primaryPointer = sample.pointerId;
    this.#downScreen = sample.screen;
    this.#lastScreen = sample.screen;
    this.#clearHover();
    if (sample.suppressed === true) {
      // The field/scrollable element keeps the gesture; nothing is captured or moved.
      this.#phase = "blocked";
      return;
    }
    // P4-17: a press inside a handle of a selected object starts the resize
    // candidate before any drag/selection logic; the handle hit area is 8 screen
    // px and the other handles/edges keep their usual behaviour.
    if (
      this.#selection.length > 0 &&
      this.#host.worldToScreen !== undefined &&
      this.#host.previewResize !== undefined
    ) {
      const selected = this.#host.selectionTargets?.() ?? this.#selection;
      for (const candidate of selected) {
        const handle = resizeHandleAt(sample.screen, candidate.world, this.#host.worldToScreen);
        if (handle !== null) {
          this.#host.capturePointer(sample.pointerId);
          this.#phase = "resizing";
          this.#target = candidate;
          this.#resize = { target: candidate, handle, last: { ...candidate.world } };
          this.#pendingToggle = false;
          this.#bandCandidate = false;
          this.#setCursor(resizeCursor(handle));
          return;
        }
      }
    }
    this.#host.capturePointer(sample.pointerId);
    const target = this.#host.hitTest(sample.screen.x, sample.screen.y);
    this.#target = target;
    this.#pendingToggle = sample.shiftKey === true;
    // L10: a Shift-drag on empty canvas is a rubber band; without Shift the same
    // drag pans (P4-14). The decision is made when the threshold is crossed.
    this.#bandCandidate = sample.shiftKey === true;
    if (target === null || !target.draggable) {
      // Empty canvas (or a presentation-only scene): the press is a pan/band
      // candidate.
      this.#phase = "pressed";
      return;
    }
    const localY = this.#localWorldY(sample.screen, target);
    if (!isGrip(target.kind, localY, this.#options.headerHeightPx)) {
      // Block/zone body below the header: dragging there moves nothing.
      this.#phase = "blocked";
      return;
    }
    if (sample.shiftKey !== true && !this.isSelected(target.id)) {
      // L10: dragging an unselected object first makes it the sole selection.
      this.#setSelection([target]);
    }
    this.#phase = "pressed";
  }

  #movePrimary(screen: InputScreenPoint, free: boolean): void {
    if (this.#phase === "resizing" && this.#resize !== null) {
      const state = this.#resize;
      const minimum =
        this.#host.resizeMinimum?.(state.target) ??
        resizeMinimumFor(state.target.kind === "zone" ? "zone" : state.target.kind === "card" ? "card" : "block");
      const world = this.#host.screenToWorld(screen.x, screen.y);
      const rect = resizeFromPointer({
        handle: state.handle,
        rect: state.target.world,
        pointer: world,
        snap: !free,
        minimum,
      });
      state.last = rect;
      this.#host.previewResize?.(state.target, rect);
      this.#setCursor(resizeCursor(state.handle));
      return;
    }
    if (this.#phase === "pressed" && this.#downScreen !== null) {
      const deltaX = screen.x - this.#downScreen.x;
      const deltaY = screen.y - this.#downScreen.y;
      if (!crossesDragThreshold(deltaX, deltaY, this.#options.thresholdPx)) {
        return;
      }
      if (this.#target !== null && this.#target.draggable) {
        this.#beginObjectDrag(screen, free);
        return;
      }
      if (this.#bandCandidate && this.#host.targetsInRect !== undefined) {
        // L10: Shift-drag on the empty canvas draws the rubber band and never
        // pans; without Shift the P4-14 pan path below stays unchanged.
        this.#phase = "band";
        this.#band = { start: this.#downScreen, rect: { x: 0, y: 0, width: 0, height: 0 } };
        this.#updateBand(screen);
        return;
      }
      this.#phase = "panning";
      this.#lastScreen = this.#downScreen;
    }
    if (this.#phase === "dragging" && this.#target !== null && this.#grabOffset !== null) {
      this.#previewSnapped(this.#target, screen, free);
      return;
    }
    if (this.#phase === "band") {
      this.#updateBand(screen);
      return;
    }
    if (this.#phase === "panning" && this.#lastScreen !== null) {
      this.#host.panByScreen(screen.x - this.#lastScreen.x, screen.y - this.#lastScreen.y);
      this.#lastScreen = screen;
    }
  }

  // L10: starts the joint drag when several objects are selected, otherwise the
  // P4-14 single-object drag. The selection is not changed by a drag.
  #beginObjectDrag(screen: InputScreenPoint, free: boolean): void {
    const target = this.#target;
    if (target === null || this.#downScreen === null) {
      return;
    }
    this.#phase = "dragging";
    this.#grabOffset = this.#grabOffsetFor(this.#downScreen, target);
    this.#pendingToggle = false;
    this.#setCursor("grabbing");
    if (!this.isSelected(target.id)) {
      this.#setSelection([target]);
    }
    const selected = this.#host.selectionTargets?.() ?? this.#selection;
    const members: InputTarget[] = [];
    const seen = new Set<string>();
    for (const candidate of [...selected, target]) {
      const key = `${candidate.kind}:${candidate.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      members.push(candidate);
    }
    if (members.length > 1 && this.#host.previewGroupDrag !== undefined) {
      this.#group = members;
      this.#groupAnchor = target;
    } else {
      this.#group = null;
      this.#groupAnchor = null;
    }
    this.#previewSnapped(target, screen, free);
  }

  // L10: world-space band rectangle from the press point to the current point.
  #updateBand(screen: InputScreenPoint): void {
    if (this.#band === null) {
      return;
    }
    const start = this.#host.screenToWorld(this.#band.start.x, this.#band.start.y);
    const current = this.#host.screenToWorld(screen.x, screen.y);
    const rect: InputWorldRect = {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
    this.#band = { start: this.#band.start, rect };
    this.#host.onBandChange?.(rect);
  }

  #clearBand(): void {
    if (this.#band === null) {
      return;
    }
    this.#band = null;
    this.#host.onBandChange?.(null);
  }

  #setSelection(targets: readonly InputTarget[]): void {
    const next: InputTarget[] = [];
    const seen = new Set<string>();
    for (const target of targets) {
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      next.push(target);
    }
    this.#selection = next;
    this.#host.onSelectionChange?.(this.#selection);
  }

  #toggleSelection(target: InputTarget): void {
    const key = `${target.kind}:${target.id}`;
    const current = this.#selection.filter(
      (candidate) => `${candidate.kind}:${candidate.id}` !== key,
    );
    this.#setSelection(current.length === this.#selection.length ? [...current, target] : current);
  }

  // L07 (P4-15): snap the raw pointer position through the host, remember it (the
  // release commits exactly this position) and preview the snapped rectangle.
  // L10 (P4-16): in a joint drag the snapped delta moves every member by the same
  // world offset. Panning and zooming never call this.
  #previewSnapped(target: InputTarget, screen: InputScreenPoint, free: boolean): void {
    if (this.#grabOffset === null) {
      return;
    }
    const raw = this.#positionFor(screen, this.#grabOffset);
    const snapped = this.#host.snapDrag?.(target, raw, free) ?? raw;
    this.#snappedPosition = snapped;
    this.#host.onDragMove?.(target, snapped);
    if (this.#group !== null && this.#groupAnchor !== null && this.#host.previewGroupDrag) {
      const deltaX = snapped.x - this.#groupAnchor.world.x;
      const deltaY = snapped.y - this.#groupAnchor.world.y;
      this.#groupMembers = this.#group.map((member) => ({
        target: member,
        position: { x: member.world.x + deltaX, y: member.world.y + deltaY },
      }));
      this.#host.previewGroupDrag(this.#groupMembers);
      return;
    }
    this.#groupMembers = null;
    this.#host.previewDrag(target, snapped);
  }

  #beginPinch(): void {
    const [first, second] = [...this.#pointers.values()];
    if (first === undefined || second === undefined) {
      return;
    }
    this.#phase = "pinch";
    this.#pinch = {
      distance: Math.max(distanceOf(first, second), 1),
      mid: midpointOf(first, second),
    };
    this.#setCursor("grabbing");
  }

  #movePinch(): void {
    const [first, second] = [...this.#pointers.values()];
    if (first === undefined || second === undefined || this.#pinch === null) {
      return;
    }
    const mid = midpointOf(first, second);
    const distance = Math.max(distanceOf(first, second), 1);
    const factor = distance / this.#pinch.distance;
    if (Number.isFinite(factor) && factor > 0) {
      this.#host.zoomByFactor(factor, mid.x, mid.y);
    }
    this.#host.panByScreen(
      -(mid.x - this.#pinch.mid.x),
      -(mid.y - this.#pinch.mid.y),
    );
    this.#pinch = { distance, mid };
  }

  #cancelDrag(): void {
    const target = this.#target;
    const members = this.#groupMembers;
    this.#target = null;
    this.#grabOffset = null;
    this.#snappedPosition = null;
    this.#group = null;
    this.#groupAnchor = null;
    this.#groupMembers = null;
    this.#host.clearSnap?.();
    if (members !== null && this.#host.revertGroupDrag !== undefined) {
      // L10: a cancelled joint drag restores every member, writes nothing and
      // keeps the selection.
      this.#host.revertGroupDrag(members);
    } else if (target !== null) {
      this.#host.revertDrag(target);
    }
  }

  #finish(): void {
    for (const pointerId of this.#pointers.keys()) {
      this.#host.releasePointer(pointerId);
    }
    this.#pointers.clear();
    this.#phase = "idle";
    this.#primaryPointer = null;
    this.#downScreen = null;
    this.#lastScreen = null;
    this.#pinch = null;
    this.#target = null;
    this.#grabOffset = null;
    this.#snappedPosition = null;
    this.#pendingToggle = false;
    this.#bandCandidate = false;
    this.#group = null;
    this.#groupAnchor = null;
    this.#groupMembers = null;
    this.#resize = null;
    this.#host.clearSnap?.();
    this.#setCursor("default");
  }

  #clearHover(): void {
    if (this.#hover === null) {
      return;
    }
    this.#hover = null;
    this.#setCursor("default");
    this.#host.onHover({
      target: null,
      grip: false,
      header: false,
      cursor: "default",
      screen: { x: 0, y: 0 },
    });
  }

  #setCursor(cursor: InputCursor): void {
    if (this.#cursor === cursor) {
      return;
    }
    this.#cursor = cursor;
    this.#host.onCursor(cursor);
  }

  #localWorldY(screen: InputScreenPoint, target: InputTarget): number {
    return this.#host.screenToWorld(screen.x, screen.y).y - target.world.y;
  }

  #grabOffsetFor(down: InputScreenPoint, target: InputTarget): InputWorldPoint {
    const world = this.#host.screenToWorld(down.x, down.y);
    return { x: world.x - target.world.x, y: world.y - target.world.y };
  }

  #positionFor(screen: InputScreenPoint, offset: InputWorldPoint): InputWorldPoint {
    const world = this.#host.screenToWorld(screen.x, screen.y);
    return { x: world.x - offset.x, y: world.y - offset.y };
  }
}

/** Creates the pointer input layer for one interactive surface. */
export function createPointerInput(options: PointerInputOptions): PointerInput {
  return new PointerInput(options);
}
