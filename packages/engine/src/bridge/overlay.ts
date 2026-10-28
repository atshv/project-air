// L18 (P4-23) DOM overlay host for field editing and inline comfort.
//
// The canvas draws the board; the fields people type into are plain DOM elements
// in a transparent layer above it. This module owns the two halves of that seam:
//
// - pure, DOM-free geometry and keyboard policy (anchor math through the camera,
//   viewport visibility, focus wrap, Enter/Tab/Shift+Tab/Backspace intents, the
//   colour-field size) so the rules are unit-tested without a browser;
// - a thin DOM host that positions registered fields from the camera transform,
//   hides fields whose object left the viewport, routes focus and stops pointer
//   events from reaching the P4-14 drag layer.
//
// The overlay is presentation and input only (ADR-0009): it owns no board state,
// never writes the document and is never a save path — the policy returns intents
// and the caller applies them to its own DOM/editor model. L05's single autosave
// stays out of scope.

/** World rectangle in the contract's pixels. */
export interface OverlayWorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Camera transform the overlay anchors through (mirrors the engine camera). */
export interface OverlayCamera {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

/** Canvas viewport in CSS px. */
export interface OverlayViewport {
  readonly width: number;
  readonly height: number;
}

/** Screen rectangle in CSS px, relative to the canvas content box. */
export interface OverlayScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One anchored field: its world anchor and the CSS rectangle it maps to. */
export interface AnchoredFieldRect extends OverlayScreenRect {
  readonly visible: boolean;
}

/**
 * Anchors a world rectangle to the canvas in CSS px. The device pixel ratio does
 * not change the result: the canvas backing store is scaled by the DPR, the DOM
 * layer stays in CSS px, so a field tracks the object at DPR 1 and 2 alike.
 * A stale/non-finite camera or viewport returns a hidden zero rectangle instead
 * of throwing (the caller closes the overlay on a stale camera).
 */
export function anchorToScreen(
  world: OverlayWorldRect,
  camera: OverlayCamera,
  viewport: OverlayViewport,
  devicePixelRatio = 1,
): AnchoredFieldRect {
  const finite =
    Number.isFinite(world.x) &&
    Number.isFinite(world.y) &&
    Number.isFinite(world.width) &&
    Number.isFinite(world.height) &&
    Number.isFinite(camera.panX) &&
    Number.isFinite(camera.panY) &&
    Number.isFinite(camera.zoom) &&
    camera.zoom > 0 &&
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0 &&
    Number.isFinite(devicePixelRatio) &&
    devicePixelRatio > 0;
  if (!finite) {
    return { x: 0, y: 0, width: 0, height: 0, visible: false };
  }
  const x = (world.x - camera.panX) * camera.zoom;
  const y = (world.y - camera.panY) * camera.zoom;
  const width = world.width * camera.zoom;
  const height = world.height * camera.zoom;
  return { x, y, width, height, visible: rectIntersectsViewport({ x, y, width, height }, viewport) };
}

/** True while any part of the screen rectangle overlaps the viewport. */
export function rectIntersectsViewport(
  rect: OverlayScreenRect,
  viewport: OverlayViewport,
): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0 &&
    rect.x < viewport.width &&
    rect.y < viewport.height
  );
}

/** One focusable field of the inline editing list, in focus order. */
export interface InlineField {
  readonly id: string;
  /** True for an entry with no content; only an empty entry is removable. */
  readonly empty: boolean;
}

/** Key input of the inline policy (a reduced `KeyboardEvent`). */
export interface InlineKeyInput {
  readonly key: string;
  readonly shiftKey?: boolean;
}

/**
 * Intent the inline policy emits for one key. The policy itself never touches
 * content, the DOM or storage: the caller applies the intent to its own model.
 */
export type InlineIntent =
  | { readonly kind: "none" }
  | { readonly kind: "focus"; readonly index: number }
  | { readonly kind: "insert"; readonly afterIndex: number; readonly focusIndex: number }
  | { readonly kind: "remove"; readonly index: number; readonly focusIndex: number | null };

/**
 * Next focus index with the documented wrap rule: moving forward past the last
 * field wraps to the first, moving backward past the first wraps to the last.
 * `count === 0` returns -1 (no field).
 */
export function nextFocusIndex(count: number, current: number, direction: 1 | -1): number {
  if (!Number.isInteger(count) || count <= 0) {
    return -1;
  }
  if (!Number.isInteger(current) || current < 0 || current >= count) {
    return direction === 1 ? 0 : count - 1;
  }
  return (current + direction + count) % count;
}

/**
 * The pure inline comfort policy over a field list and one key event.
 *
 * - `Enter`: insert a new entry directly below the focused one and focus it
 *   (`insert` with `afterIndex = focused`).
 * - `Tab` / `Shift+Tab`: focus the next/previous field, wrapping at the ends.
 * - `Backspace` on an empty entry: remove it and focus the previous entry (the
 *   field before it; removing the first focuses the new first, the last removed
 *   field leaves no focus when the list becomes empty). On a non-empty entry the
 *   key just stays with the field.
 * - Every other key, and an invalid focus index, returns `none`.
 *
 * The policy is pure: repeated calls with the same input return an equal intent
 * and the field list is never mutated.
 */
export function applyInlineKey(
  fields: readonly InlineField[],
  focusedIndex: number,
  event: InlineKeyInput,
): InlineIntent {
  const count = fields.length;
  if (count === 0 || !Number.isInteger(focusedIndex) || focusedIndex < 0 || focusedIndex >= count) {
    return { kind: "none" };
  }
  if (event.key === "Enter") {
    return { kind: "insert", afterIndex: focusedIndex, focusIndex: focusedIndex + 1 };
  }
  if (event.key === "Tab") {
    return { kind: "focus", index: nextFocusIndex(count, focusedIndex, event.shiftKey === true ? -1 : 1) };
  }
  if (event.key === "Backspace") {
    const field = fields[focusedIndex];
    if (field === undefined || !field.empty) {
      return { kind: "none" };
    }
    if (count === 1) {
      return { kind: "remove", index: focusedIndex, focusIndex: null };
    }
    const focusIndex = focusedIndex > 0 ? focusedIndex - 1 : 0;
    return { kind: "remove", index: focusedIndex, focusIndex };
  }
  return { kind: "none" };
}

/** Token size of the colour control (24 px = the `space-24` token value). */
export const COLOUR_FIELD_PX = 24;

/**
 * CSS size of the colour field. No raw value: the arena reads the token through
 * the generated CSS variable, and the 24 px token value is duplicated here only
 * for the unit assertion (new tokens are out of scope for L18).
 */
export function colourFieldStyle(sizePx: number = COLOUR_FIELD_PX): {
  readonly width: string;
  readonly height: string;
} {
  if (!Number.isFinite(sizePx) || sizePx <= 0) {
    throw new RangeError("the colour field size must be a positive, finite number");
  }
  return { width: `${sizePx}px`, height: `${sizePx}px` };
}

/** Minimal element surface the pointer-routing helper needs (DOM-free tests). */
export interface FieldPointerTarget {
  addEventListener(type: string, listener: (event: FieldPointerEvent) => void): void;
}

/** Minimal event surface of the routing helper. */
export interface FieldPointerEvent {
  stopPropagation(): void;
  preventDefault(): void;
}

/**
 * Stops pointer/mouse/click events of one field at the field, so the P4-14 input
 * layer on the canvas wrapper never receives them and can never start a drag or
 * a selection from a field. Wheel events are stopped for the same reason but are
 * never `preventDefault`ed: a scrollable field keeps its native scrolling.
 */
export function bindFieldPointerRouting(element: FieldPointerTarget): void {
  const stop = (event: FieldPointerEvent): void => {
    event.stopPropagation();
  };
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    element.addEventListener(type, stop);
  }
  element.addEventListener("wheel", stop);
}

/** One field registered with the DOM host. */
export interface OverlayField {
  readonly id: string;
  readonly world: OverlayWorldRect;
  readonly element: HTMLElement;
}

/** Options of the DOM overlay host. */
export interface OverlayHostOptions {
  /** The transparent layer above the canvas (position: absolute; inset: 0). */
  readonly layer: HTMLElement;
  /** The canvas content box the anchors are relative to. */
  readonly canvas: HTMLElement;
  /** Optional focus-change callback for the caller's HUD/evidence. */
  readonly onFocusChange?: (id: string | null) => void;
}

/**
 * DOM host of the overlay. It positions the registered fields from the camera
 * transform, hides a field while its object is outside the viewport, routes focus
 * (open/close/restore) and stops field pointer events from reaching the canvas
 * drag layer. It never rebuilds the field nodes, so focus survives every camera
 * update; a disposed/stale camera hides all fields.
 */
export class OverlayHost {
  readonly #layer: HTMLElement;
  readonly #canvas: HTMLElement;
  readonly #fields = new Map<string, OverlayField>();
  readonly #order: string[] = [];
  readonly #onFocusChange: ((id: string | null) => void) | undefined;
  #activeId: string | null = null;
  #previousFocus: HTMLElement | null = null;
  #disposed = false;

  constructor(options: OverlayHostOptions) {
    this.#layer = options.layer;
    this.#canvas = options.canvas;
    this.#onFocusChange = options.onFocusChange;
  }

  /** Registers one field and binds its pointer routing. */
  register(field: OverlayField): void {
    if (this.#disposed) {
      throw new Error("the overlay host is disposed");
    }
    if (this.#fields.has(field.id)) {
      throw new Error(`the overlay already has a field ${JSON.stringify(field.id)}`);
    }
    bindFieldPointerRouting(field.element);
    field.element.hidden = true;
    this.#layer.append(field.element);
    this.#fields.set(field.id, field);
    this.#order.push(field.id);
  }

  /** Re-anchors one field (an inline insert/remove shifts the entries below it). */
  setWorld(id: string, world: OverlayWorldRect): void {
    const field = this.#fields.get(id);
    if (field === undefined) {
      return;
    }
    this.#fields.set(id, { ...field, world });
  }

  /** Unregisters one field (its element is removed from the layer). */
  unregister(id: string): void {
    const field = this.#fields.get(id);
    if (field === undefined) {
      return;
    }
    if (this.#activeId === id) {
      this.close();
    }
    field.element.remove();
    this.#fields.delete(id);
    const index = this.#order.indexOf(id);
    if (index >= 0) {
      this.#order.splice(index, 1);
    }
  }

  /** Field ids in focus (registration) order. */
  fieldIds(): readonly string[] {
    return [...this.#order];
  }

  /** The id of the field that currently holds focus, or null. */
  get activeId(): string | null {
    return this.#activeId;
  }

  /**
   * Repositions and clips every field for one camera/viewport state. Only style
   * and visibility change, never the nodes, so the browser keeps focus.
   */
  update(camera: OverlayCamera, viewport: OverlayViewport, devicePixelRatio = 1): void {
    if (this.#disposed) {
      return;
    }
    for (const id of this.#order) {
      const field = this.#fields.get(id);
      if (field === undefined) {
        continue;
      }
      const rect = anchorToScreen(field.world, camera, viewport, devicePixelRatio);
      if (!rect.visible) {
        field.element.hidden = true;
        continue;
      }
      field.element.hidden = false;
      field.element.style.left = `${rect.x}px`;
      field.element.style.top = `${rect.y}px`;
      field.element.style.width = `${rect.width}px`;
    }
  }

  /** Focuses one registered field, remembering the element to restore on close. */
  open(id: string): boolean {
    const field = this.#fields.get(id);
    if (this.#disposed || field === undefined) {
      return false;
    }
    const active = this.#canvas.ownerDocument.activeElement;
    this.#previousFocus = active instanceof HTMLElement ? active : null;
    this.#activeId = id;
    field.element.focus();
    this.#onFocusChange?.(id);
    return true;
  }

  /** Closes the active field and restores the focus that was active before. */
  close(): void {
    if (this.#activeId === null) {
      return;
    }
    const active = this.#activeId;
    this.#activeId = null;
    this.#onFocusChange?.(null);
    const previous = this.#previousFocus;
    this.#previousFocus = null;
    if (previous !== null && previous.isConnected && previous !== this.#canvas.ownerDocument.activeElement) {
      previous.focus();
    }
    if (active !== null) {
      const field = this.#fields.get(active);
      field?.element.blur();
    }
  }

  /** Removes every field and forgets the focus state (engine disposed/reloaded). */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.close();
    for (const id of [...this.#order]) {
      this.unregister(id);
    }
    this.#disposed = true;
  }
}
