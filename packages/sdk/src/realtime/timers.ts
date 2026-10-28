// P5-04: injectable time so debounce/backoff/latency tests are deterministic.

export interface Timers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  now(): number;
}

export const realTimers: Timers = {
  setTimeout: (callback, delayMs) => (globalThis as unknown as { setTimeout(cb: () => void, ms: number): number }).setTimeout(callback, delayMs),
  clearTimeout: (handle) => (globalThis as unknown as { clearTimeout(handle: number): void }).clearTimeout(handle),
  now: () => Date.now(),
};
