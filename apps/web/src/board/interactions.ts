// P6-05 (L12/L11 web half): pure interaction helpers — keyboard mapping and
// field suppression, arrow-burst grouping, context-menu model, undo hint and the
// fractional z helper for the contract reorder action.
export type ShortcutAction = "duplicate" | "delete" | "escape" | "arrowUp" | "arrowDown" | "arrowLeft" | "arrowRight" | "undo" | "redo" | null;

export interface KeyLike { readonly key: string; readonly metaKey?: boolean; readonly ctrlKey?: boolean; readonly shiftKey?: boolean; readonly altKey?: boolean; }

export function isModifier(event: KeyLike): boolean { return event.metaKey === true || event.ctrlKey === true; }

export function shortcutFor(event: KeyLike): ShortcutAction {
  const modifier = isModifier(event);
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (modifier && key === "d") return "duplicate";
  if (modifier && key === "z") return event.shiftKey === true ? "redo" : "undo";
  if (key === "Escape") return "escape";
  if (key === "Delete" || key === "Backspace") return "delete";
  if (key === "ArrowUp") return "arrowUp";
  if (key === "ArrowDown") return "arrowDown";
  if (key === "ArrowLeft") return "arrowLeft";
  if (key === "ArrowRight") return "arrowRight";
  return null;
}

export interface FocusLike { readonly tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown }
export function suppressesShortcuts(target: FocusLike | null | undefined): boolean {
  if (target === null || target === undefined) return false;
  const tag = target.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable === true) return true;
  if (typeof target.closest === "function" && target.closest("[role='dialog'], [contenteditable='true']") !== null) return true;
  return false;
}

export const ARROW_STEP = 16;
export const ARROW_BURST_MS = 300;
export function arrowDelta(action: ShortcutAction, shift: boolean): { dx: number; dy: number } {
  const step = shift ? ARROW_STEP * 10 : ARROW_STEP;
  switch (action) {
    case "arrowUp": return { dx: 0, dy: -step };
    case "arrowDown": return { dx: 0, dy: step };
    case "arrowLeft": return { dx: -step, dy: 0 };
    case "arrowRight": return { dx: step, dy: 0 };
    default: return { dx: 0, dy: 0 };
  }
}

/** Accumulates arrow presses and flushes one delta after the burst window. */
export function createArrowBurst(onFlush: (delta: { dx: number; dy: number }) => void, schedule: (callback: () => void, ms: number) => number = (callback, ms) => setTimeout(callback, ms) as unknown as number): { push(dx: number, dy: number): void; flush(): void; pending(): { dx: number; dy: number } } {
  let dx = 0; let dy = 0; let timer: number | null = null;
  const flush = (): void => { timer = null; if (dx === 0 && dy === 0) return; const delta = { dx, dy }; dx = 0; dy = 0; onFlush(delta); };
  return {
    push(nextX, nextY) { dx += nextX; dy += nextY; if (timer !== null) clearTimeout(timer); timer = schedule(flush, ARROW_BURST_MS); },
    flush,
    pending: () => ({ dx, dy }),
  };
}

export interface MenuItemModel { readonly id: "open" | "duplicate" | "bringForward" | "sendBackward" | "delete"; readonly labelKey: string; readonly shortcut: string; readonly disabled: boolean; readonly disabledKey?: string; }
export function contextMenuModel(input: { readonly hasSelection: boolean; readonly multiSelection: boolean }): readonly MenuItemModel[] {
  const disabled = !input.hasSelection;
  const duplicateDisabled = disabled || input.multiSelection;
  return [
    { id: "open", labelKey: "board.menu.open", shortcut: "Enter", disabled },
    { id: "duplicate", labelKey: "board.menu.duplicate", shortcut: "Mod+D", disabled: duplicateDisabled, ...(duplicateDisabled ? { disabledKey: input.multiSelection ? "board.menu.multiUnsupported" : "board.menu.noSelection" } : {}) },
    { id: "bringForward", labelKey: "board.menu.bringForward", shortcut: "]", disabled },
    { id: "sendBackward", labelKey: "board.menu.sendBackward", shortcut: "[", disabled },
    { id: "delete", labelKey: "board.menu.delete", shortcut: "Del", disabled },
  ];
}

export function undoHintKey(action: "undo" | "redo"): string { return action === "undo" ? "board.undo.undo" : "board.undo.redo"; }

/** Contract reorder z between two neighbours (fractional, deterministic) and its inverse. */
export function fractionalZ(previous: string | null, next: string | null): { z: string; previousZ: string | null } {
  const parse = (value: string | null): number | null => value === null ? null : Number.parseFloat(value);
  const before = parse(previous); const after = parse(next);
  if (before === null && after === null) return { z: "m", previousZ: null };
  if (before === null) return { z: String(((after as number) - 1) / 1).slice(0, 8), previousZ: null };
  if (after === null) return { z: String(before + 1), previousZ: previous };
  return { z: String((before + after) / 2), previousZ: previous };
}
