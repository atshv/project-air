// P5-04 / L05: the one autosave path of the SDK. 400 ms debounce after the last
// keystroke, immediate flush on blur/panel close/navigation/visibilitychange
// hidden/pagehide, monotonic save sequences (an older response never overwrites a
// newer value) and saving -> saved -> error status events with retry().
//
// There is no second writer: the caller passes the one persist function and the
// autosave path owns debouncing/flushing/sequences/status.

export const AUTOSAVE_DEBOUNCE_MS = 400;

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";
export type AutosaveEvent =
  | { readonly type: "status"; readonly status: AutosaveStatus; readonly value: string; readonly sequence: number }
  | { readonly type: "saved"; readonly value: string; readonly sequence: number }
  | { readonly type: "error"; readonly error: unknown; readonly value: string; readonly sequence: number };

export interface AutosaveTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface AutosaveOptions {
  /** The one persist function (no second writer/persistence in the SDK). */
  readonly save: (value: string, sequence: number) => Promise<unknown>;
  readonly debounceMs?: number;
  readonly timers?: AutosaveTimers;
  readonly onChange?: (event: AutosaveEvent) => void;
}

export interface Autosave {
  update(value: string): void;
  flush(reason?: string): Promise<boolean>;
  retry(): Promise<boolean>;
  value(): string;
  status(): AutosaveStatus;
  sequence(): number;
  detach(): void;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const timers = options.timers ?? { setTimeout: (cb, ms) => (globalThis as unknown as { setTimeout(cb: () => void, ms: number): number }).setTimeout(cb, ms), clearTimeout: (h) => (globalThis as unknown as { clearTimeout(h: number): void }).clearTimeout(h) };
  let timer: number | null = null;
  let current = "";
  let sequence = 0;
  let latestRequested = 0;
  let latestApplied = 0;
  let status: AutosaveStatus = "idle";

  const emit = (event: AutosaveEvent): void => options.onChange?.(event);
  const setStatus = (next: AutosaveStatus): void => {
    status = next;
    emit({ type: "status", status: next, value: current, sequence: latestRequested });
  };
  const clear = (): void => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  };

  const persist = async (): Promise<boolean> => {
    clear();
    const value = current;
    if (value.length === 0) {
      setStatus("idle");
      return false;
    }
    const requestSequence = ++sequence;
    latestRequested = requestSequence;
    setStatus("saving");
    try {
      await options.save(value, requestSequence);
      // Monotonicity: only the response of the newest request may update the
      // saved state; an older, later-resolving response never overwrites it.
      if (requestSequence < latestRequested) return false;
      latestApplied = requestSequence;
      setStatus("saved");
      emit({ type: "saved", value, sequence: requestSequence });
      return true;
    } catch (error) {
      if (requestSequence < latestRequested) return false;
      setStatus("error");
      emit({ type: "error", error, value, sequence: requestSequence });
      return false;
    }
  };

  // Every flush persists the latest value with a fresh monotonic sequence; a
  // flush that arrives while an older save is in flight must not be swallowed
  // (flush triggers are immediate and the newest value wins).
  const flush = (): Promise<boolean> => persist();

  const schedule = (): void => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = null; void flush(); }, debounceMs);
  };

  return {
    update(value: string): void {
      current = value;
      if (status === "saved" || status === "error") status = "idle";
      schedule();
    },
    flush(reason?: string): Promise<boolean> {
      void reason;
      return flush();
    },
    retry(): Promise<boolean> {
      if (status !== "error") return Promise.resolve(false);
      return flush();
    },
    value: () => current,
    status: () => status,
    sequence: () => latestApplied,
    detach: clear,
  };
}

/** The five immediate-flush triggers (blur, panel close, navigation, visibilitychange, pagehide). */
export interface FlushEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export function installFlushTriggers(input: {
  readonly autosave: Pick<Autosave, "flush">;
  readonly windowTarget?: FlushEventTarget | null;
  readonly documentTarget?: FlushEventTarget | null;
  readonly isHidden?: () => boolean;
  readonly onPanelClose?: (register: (callback: () => void) => void) => void;
}): () => void {
  const handlers: [FlushEventTarget, string, () => void][] = [];
  const flush = (): void => { void input.autosave.flush("trigger"); };
  const visibility = (): void => {
    if (input.isHidden?.() === true) flush();
  };
  const add = (target: FlushEventTarget | null | undefined, type: string, handler: () => void = flush): void => {
    if (target === null || target === undefined) return;
    target.addEventListener(type, handler);
    handlers.push([target, type, handler]);
  };
  add(input.windowTarget, "blur");
  add(input.windowTarget, "beforeunload"); // navigation away from the page
  add(input.windowTarget, "pagehide");
  add(input.documentTarget, "visibilitychange", visibility);
  input.onPanelClose?.(flush);
  return () => {
    for (const [target, type, handler] of handlers) target.removeEventListener(type, handler);
  };
}
