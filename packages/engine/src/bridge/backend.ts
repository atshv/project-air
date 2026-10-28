// P4-12: WebGPU capability probe, backend selection and fallback.
//
// One decision point for an engine instance: probe the browser capability once,
// create exactly one renderer (WebGL2 or WebGPU) and report the active backend
// plus a stable reason identifier. Never render WebGL2 while reporting WebGPU and
// never leave a half-created renderer behind.
//
// The module is dependency-free and injectable: the probe and both renderer
// factories are parameters, so Node tests exercise every branch with fakes while
// the browser uses `createBrowserCapabilityProbe()` with the real
// navigator.gpu requestAdapter()/requestDevice() calls behind a bounded timeout.

/** Backend explicitly or automatically selected by the engine. */
export type ActiveBackend = "webgl2" | "webgpu";
/** Requested backend; `auto` prefers WebGPU and falls back to WebGL2. */
export type RequestedBackend = "auto" | ActiveBackend;

/**
 * Stable fallback/selection reasons (never raw exception text). `ok` means the
 * requested/preferred backend was created; the other values are the fallback or
 * clean-failure reasons documented in docs/engine.md.
 */
export type BackendReason =
  | "ok"
  | "webgpu-unavailable"
  | "adapter-null"
  | "device-rejected"
  | "probe-timeout"
  | "renderer-create-failed"
  | "webgl2-unavailable";

/** Adapter identity the browser reported during the probe (P4-12 evidence). */
export interface AdapterIdentity {
  readonly vendor: string;
  readonly architecture: string;
  readonly description: string;
}

/** Typed capability result; a failed probe never throws. */
export type CapabilityResult =
  | { readonly available: true; readonly adapter: AdapterIdentity }
  | {
      readonly available: false;
      readonly reason: Exclude<BackendReason, "ok" | "renderer-create-failed" | "webgl2-unavailable">;
    };

/** Injectable capability probe; one call per engine instance. */
export interface CapabilityProbe {
  probe(): Promise<CapabilityResult>;
}

/** Stable reason -> C ABI code (docs/engine.md and wasm smoke share this table). */
export const BACKEND_REASON_CODES: Readonly<Record<BackendReason, number>> = {
  ok: 0,
  "webgpu-unavailable": 1,
  "adapter-null": 2,
  "device-rejected": 3,
  "probe-timeout": 4,
  "renderer-create-failed": 5,
  "webgl2-unavailable": 6,
};

/** C ABI backend codes: 0 none, 1 webgl2, 2 webgpu. */
export const BACKEND_CODES: Readonly<Record<ActiveBackend, number>> = {
  webgl2: 1,
  webgpu: 2,
};

/** Bounded probe timeout; a slow browser must not freeze the page. */
export const PROBE_TIMEOUT_MS = 750;

/** Minimal navigator.gpu surface the probe needs (injectable for tests). */
export interface GpuAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly description?: string;
}
export interface GpuDeviceLike {
  destroy?(): void;
}
export interface GpuAdapterLike {
  readonly info?: GpuAdapterInfoLike;
  requestDevice(): Promise<GpuDeviceLike>;
}
export interface GpuLike {
  requestAdapter(options?: { readonly powerPreference?: string }): Promise<GpuAdapterLike | null>;
}

function adapterIdentity(adapter: GpuAdapterLike): AdapterIdentity {
  return {
    vendor: adapter.info?.vendor ?? "",
    architecture: adapter.info?.architecture ?? "",
    description: adapter.info?.description ?? "",
  };
}

/**
 * Browser capability probe: navigator.gpu -> requestAdapter() ->
 * adapter.requestDevice(), all inside one bounded timeout. The device created for
 * the capability check is destroyed immediately, so a successful probe leaks no
 * partial device; a late success after the timeout is destroyed too. Every
 * failure maps to a stable reason, never to an exception.
 */
export function createBrowserCapabilityProbe(
  options: { readonly timeoutMs?: number; readonly gpu?: GpuLike | null } = {},
): CapabilityProbe {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const gpu = options.gpu === undefined ? ((globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu ?? null) : options.gpu;
  return {
    async probe(): Promise<CapabilityResult> {
      if (gpu === null || gpu === undefined) {
        return { available: false, reason: "webgpu-unavailable" };
      }
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<CapabilityResult>((resolve) => {
        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ available: false, reason: "probe-timeout" });
          }
        }, Math.max(1, timeoutMs));
      });
      const work = (async (): Promise<CapabilityResult> => {
        let adapter: GpuAdapterLike | null;
        try {
          adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        } catch {
          return { available: false, reason: "webgpu-unavailable" };
        }
        if (adapter === null) {
          return { available: false, reason: "adapter-null" };
        }
        try {
          const device = await adapter.requestDevice();
          // Capability probe only: never keep the device/queue alive.
          device.destroy?.();
          if (settled) {
            return { available: false, reason: "probe-timeout" };
          }
          return { available: true, adapter: adapterIdentity(adapter) };
        } catch {
          // Nothing was created (requestDevice rejected): no device to release.
          return { available: false, reason: "device-rejected" };
        }
      })();
      const result = await Promise.race([work, timeout]);
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      return result;
    },
  };
}

/** Thrown when no renderer can be created; `code` is a stable reason. */
export class BackendSelectionError extends Error {
  readonly code: BackendReason;
  constructor(code: BackendReason) {
    super(`backend selection failed: ${code}`);
    this.name = "BackendSelectionError";
    this.code = code;
  }
}

export interface SelectionOptions<T> {
  readonly requested: RequestedBackend;
  readonly probe: CapabilityProbe;
  /** Creates and returns the WebGL2 renderer; throws (or rejects) on failure. */
  readonly createWebgl2: () => T | Promise<T>;
  /** Creates and returns the WebGPU renderer; throws (or rejects) on failure. */
  readonly createWebgpu: () => T | Promise<T>;
}

export interface SelectionResult<T> {
  readonly active: ActiveBackend;
  readonly reason: BackendReason;
  readonly renderer: T;
  readonly adapter: AdapterIdentity | null;
  /** True when `auto` fell back to WebGL2. */
  readonly fallback: boolean;
}

/**
 * The single selection decision point.
 *
 * - `webgl2`: create WebGL2 directly (no probe, the byte-identical default path).
 * - `auto`: probe once; WebGPU when the probe passes, WebGL2 otherwise. A probe
 *   failure and a WebGPU renderer-creation failure both fall back to WebGL2 with
 *   their reason; `fallback` is true and exactly one renderer is active.
 * - `webgpu`: probe once and create WebGPU; an unavailable capability or a
 *   creation failure fails cleanly with a `BackendSelectionError` (never a silent
 *   WebGL2 renderer reporting WebGPU).
 */
export async function selectBackend<T>(
  options: SelectionOptions<T>,
): Promise<SelectionResult<T>> {
  if (options.requested === "webgl2") {
    try {
      const renderer = await options.createWebgl2();
      return { active: "webgl2", reason: "ok", renderer, adapter: null, fallback: false };
    } catch {
      throw new BackendSelectionError("webgl2-unavailable");
    }
  }
  const capability = await options.probe.probe();
  if (options.requested === "webgpu" && !capability.available) {
    throw new BackendSelectionError(capability.reason);
  }
  if (capability.available) {
    try {
      const renderer = await options.createWebgpu();
      return {
        active: "webgpu",
        reason: "ok",
        renderer,
        adapter: capability.adapter,
        fallback: false,
      };
    } catch {
      if (options.requested === "webgpu") {
        throw new BackendSelectionError("renderer-create-failed");
      }
      // `auto`: WebGPU creation failed cleanly (no partial renderer); fall back.
      try {
        const renderer = await options.createWebgl2();
        return {
          active: "webgl2",
          reason: "renderer-create-failed",
          renderer,
          adapter: capability.adapter,
          fallback: true,
        };
      } catch {
        throw new BackendSelectionError("webgl2-unavailable");
      }
    }
  }
  try {
    const renderer = await options.createWebgl2();
    return {
      active: "webgl2",
      reason: capability.reason,
      renderer,
      adapter: null,
      fallback: true,
    };
  } catch {
    throw new BackendSelectionError("webgl2-unavailable");
  }
}
