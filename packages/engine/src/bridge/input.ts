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
export type InputCursor = "default" | "grab" | "grabbing" | "text";

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

type Phase = "idle" | "pressed" | "dragging" | "panning" | "pinch" | "blocked";

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
    // reverted first (a cancelled gesture writes nothing).
    if (this.#phase === "dragging") {
      this.#cancelDrag();
    }
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
    if (this.#phase === "dragging" && this.#target !== null && this.#grabOffset !== null) {
      // Commit exactly the position the preview showed (the snapped one, or the
      // free pointer position while Shift was held at the last move).
      const position =
        this.#snappedPosition ?? this.#positionFor(sample.screen, this.#grabOffset);
      const target = this.#target;
      this.#target = null;
      this.#grabOffset = null;
      this.#finish();
      this.#host.commitDrag(target, position);
      return;
    }
    if (this.#phase === "pressed") {
      // Below the threshold: a click. It writes no position and no history.
      const target = this.#target;
      this.#target = null;
      this.#finish();
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
    this.#finish();
  }

  /** Cancels every pointer, e.g. on blur. A running drag is reverted, never written. */
  cancelAll(): void {
    if (this.#phase === "dragging") {
      this.#cancelDrag();
    }
    this.#finish();
    this.#clearHover();
  }

  /** Hover update for a pointer move without a pressed button. */
  pointerHover(sample: PointerSample): void {
    if (this.#pointers.size > 0) {
      return;
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
    this.#host.capturePointer(sample.pointerId);
    const target = this.#host.hitTest(sample.screen.x, sample.screen.y);
    this.#target = target;
    if (target === null || !target.draggable) {
      // Empty canvas (or a presentation-only scene): the press is a pan candidate.
      this.#phase = "pressed";
      return;
    }
    const localY = this.#localWorldY(sample.screen, target);
    if (!isGrip(target.kind, localY, this.#options.headerHeightPx)) {
      // Block/zone body below the header: dragging there moves nothing.
      this.#phase = "blocked";
      return;
    }
    this.#phase = "pressed";
  }

  #movePrimary(screen: InputScreenPoint, free: boolean): void {
    if (this.#phase === "pressed" && this.#downScreen !== null) {
      const deltaX = screen.x - this.#downScreen.x;
      const deltaY = screen.y - this.#downScreen.y;
      if (!crossesDragThreshold(deltaX, deltaY, this.#options.thresholdPx)) {
        return;
      }
      if (this.#target !== null && this.#target.draggable) {
        this.#phase = "dragging";
        this.#grabOffset = this.#grabOffsetFor(this.#downScreen, this.#target);
        this.#setCursor("grabbing");
        this.#previewSnapped(this.#target, screen, free);
        return;
      }
      this.#phase = "panning";
      this.#lastScreen = this.#downScreen;
    }
    if (this.#phase === "dragging" && this.#target !== null && this.#grabOffset !== null) {
      this.#previewSnapped(this.#target, screen, free);
      return;
    }
    if (this.#phase === "panning" && this.#lastScreen !== null) {
      this.#host.panByScreen(screen.x - this.#lastScreen.x, screen.y - this.#lastScreen.y);
      this.#lastScreen = screen;
    }
  }

  // L07 (P4-15): snap the raw pointer position through the host, remember it (the
  // release commits exactly this position) and preview the snapped rectangle.
  // Panning and zooming never call this, so no snap work runs outside a drag.
  #previewSnapped(target: InputTarget, screen: InputScreenPoint, free: boolean): void {
    if (this.#grabOffset === null) {
      return;
    }
    const raw = this.#positionFor(screen, this.#grabOffset);
    const snapped = this.#host.snapDrag?.(target, raw, free) ?? raw;
    this.#snappedPosition = snapped;
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
    this.#target = null;
    this.#grabOffset = null;
    this.#snappedPosition = null;
    this.#host.clearSnap?.();
    if (target !== null) {
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
