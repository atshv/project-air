// P4-20 (L12): the keyboard intent layer and the context-menu model.
//
// One routing table: shortcuts and context-menu entries produce the same intents.
// When a field owns the focus (the P4-14 suppression predicate) every shortcut is
// blocked; only Escape still works (it closes the field/editing state).
//
// Values from tokens: the menu width (200 px) and row height (32 px) are L12
// interaction values documented as named constants; colours/spacing come from the
// generated CSS tokens.

/** L12 interaction value: context-menu width in CSS px. */
export const CONTEXT_MENU_WIDTH_PX = 200;
/** L12 interaction value: context-menu row height in CSS px. */
export const CONTEXT_MENU_ROW_PX = 32;
/** Arrow nudge in world px. */
export const NUDGE_STEP_PX = 16;
/** Shift-arrow nudge in world px. */
export const NUDGE_STEP_FAST_PX = 160;
/** The series commits this long after the last arrow key. */
export const NUDGE_COMMIT_DELAY_MS = 300;

export type KeyboardIntent =
  | { readonly kind: "duplicate" }
  | { readonly kind: "delete" }
  | { readonly kind: "nudge"; readonly dx: number; readonly dy: number }
  | { readonly kind: "escape" }
  | { readonly kind: "menu-open" }
  | null;

export interface KeyboardEventLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly suppressed?: boolean;
  /** True for `Shift+F10` or the dedicated ContextMenu key. */
  readonly contextMenuKey?: boolean;
}

const ARROW_DELTAS: Readonly<Record<string, { dx: number; dy: number }>> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/**
 * Maps one key event to an intent. Outside fields: duplicate, delete, nudge,
 * Escape and menu opening (Shift+F10 / ContextMenu). Inside a field only Escape
 * is mapped (the field/editing state owns everything else).
 */
export function keyboardIntent(event: KeyboardEventLike): KeyboardIntent {
  if (event.key === "Escape") {
    return { kind: "escape" };
  }
  if (event.suppressed === true) {
    return null;
  }
  if (event.altKey === true) {
    return null;
  }
  if (event.contextMenuKey === true) {
    return { kind: "menu-open" };
  }
  if ((event.ctrlKey === true || event.metaKey === true) && (event.key === "d" || event.key === "D")) {
    return { kind: "duplicate" };
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    return { kind: "delete" };
  }
  const arrow = ARROW_DELTAS[event.key];
  if (arrow !== undefined) {
    const step = event.shiftKey === true ? NUDGE_STEP_FAST_PX : NUDGE_STEP_PX;
    return { kind: "nudge", dx: arrow.dx * step, dy: arrow.dy * step };
  }
  return null;
}

/** One accumulated arrow-key nudge series, committed once after a short pause. */
export class NudgeSeries {
  #dx = 0;
  #dy = 0;
  #lastAt = 0;
  #pending = false;

  get pending(): boolean {
    return this.#pending;
  }

  get delta(): { readonly dx: number; readonly dy: number } {
    return { dx: this.#dx, dy: this.#dy };
  }

  /** Adds one arrow step; the delay timer restarts on every key (key repeat safe). */
  add(dx: number, dy: number, nowMs: number): void {
    this.#dx += dx;
    this.#dy += dy;
    this.#lastAt = nowMs;
    this.#pending = true;
  }

  /** True when the series has been idle for the commit delay since `nowMs`. */
  due(nowMs: number, delayMs = NUDGE_COMMIT_DELAY_MS): boolean {
    return this.#pending && nowMs - this.#lastAt >= delayMs;
  }

  /** Returns and clears the accumulated delta (one operation per series). */
  flush(): { readonly dx: number; readonly dy: number } | null {
    if (!this.#pending || (this.#dx === 0 && this.#dy === 0)) {
      this.#pending = false;
      this.#dx = 0;
      this.#dy = 0;
      return null;
    }
    const delta = { dx: this.#dx, dy: this.#dy };
    this.#dx = 0;
    this.#dy = 0;
    this.#lastAt = 0;
    this.#pending = false;
    return delta;
  }
}

export type EscapeTarget = "menu" | "overlay" | "selection" | null;

/** Esc priority: context menu, then an open overlay/editing field, then selection. */
export function escapePriority(state: {
  readonly menuOpen: boolean;
  readonly overlayOpen: boolean;
  readonly hasSelection: boolean;
}): EscapeTarget {
  if (state.menuOpen) {
    return "menu";
  }
  if (state.overlayOpen) {
    return "overlay";
  }
  if (state.hasSelection) {
    return "selection";
  }
  return null;
}

export type ContextMenuIntent = "open" | "duplicate" | "bring-forward" | "send-backward" | "delete";

export interface ContextMenuItem {
  readonly intent: ContextMenuIntent;
  readonly label: string;
  readonly shortcut: string;
}

/** The L12 menu entries in order, with the shortcuts shown right-aligned. */
export const CONTEXT_MENU_ITEMS: readonly ContextMenuItem[] = [
  { intent: "open", label: "Open", shortcut: "Enter" },
  { intent: "duplicate", label: "Duplicate", shortcut: "⌘D" },
  { intent: "bring-forward", label: "Bring forward", shortcut: "" },
  { intent: "send-backward", label: "Send backward", shortcut: "" },
  { intent: "delete", label: "Delete", shortcut: "Del" },
];

/** Pure keyboard/pointer model of the context menu (one behaviour for both). */
export class ContextMenuModel {
  readonly items: readonly ContextMenuItem[];
  #open = false;
  #index = 0;

  constructor(items: readonly ContextMenuItem[] = CONTEXT_MENU_ITEMS) {
    this.items = items;
  }

  get open(): boolean {
    return this.#open;
  }

  get index(): number {
    return this.#index;
  }

  get selected(): ContextMenuItem | null {
    return this.#open ? this.items[this.#index] ?? null : null;
  }

  openAt(index = 0): ContextMenuItem {
    this.#open = true;
    this.#index = Math.max(0, Math.min(index, this.items.length - 1));
    return this.items[this.#index]!;
  }

  close(): void {
    this.#open = false;
    this.#index = 0;
  }

  /** Arrow keys wrap around (`ArrowDown`/`ArrowUp`). */
  move(delta: number): ContextMenuItem | null {
    if (!this.#open || this.items.length === 0) {
      return null;
    }
    const size = this.items.length;
    this.#index = (((this.#index + delta) % size) + size) % size;
    return this.items[this.#index]!;
  }

  /** Enter/Space or a click activates the selected entry and closes the menu. */
  activate(index?: number): ContextMenuIntent | null {
    if (!this.#open) {
      return null;
    }
    const selected = index === undefined ? this.selected : this.items[index] ?? null;
    this.close();
    return selected?.intent ?? null;
  }

  /** A click anywhere outside the menu closes it without an action. */
  outsideClick(): boolean {
    if (!this.#open) {
      return false;
    }
    this.close();
    return true;
  }
}
