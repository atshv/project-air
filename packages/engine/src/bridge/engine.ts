// Thin TypeScript bridge over the engine WebAssembly module (P2-03).
//
// It loads the Emscripten-generated engine.js, starts the module with the target
// canvas, calls the small exported C API and turns failures into EngineError.
// The bridge owns no visual values: tones and layers travel as ordinals and the
// C++ side maps them to packages/ui-kit tokens.

export type ToneName =
  | "neutral"
  | "tone-a"
  | "tone-b"
  | "tone-c"
  | "tone-d"
  | "tone-e";

export type LayerName = "zones" | "blocks" | "note-cards";

export interface EngineRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tone?: ToneName;
  readonly layer?: LayerName;
}

export interface EngineCamera {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

export interface EngineOptions {
  /** URL of the Emscripten engine.js; defaults to the build-wasm artifact. */
  readonly moduleUrl?: string | URL;
}

export interface Engine {
  readonly canvas: HTMLCanvasElement;
  loadRectangles(rectangles: readonly EngineRectangle[]): void;
  setCamera(camera: EngineCamera): void;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  renderFrame(): void;
  lastError(): string;
  dispose(): void;
}

export class EngineError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "EngineError";
  }
}

type CcallArgumentType = "number" | "string";
type CcallArgument = number | string;

interface EngineModule {
  ccall(
    name: string,
    returnType: "number",
    argumentTypes: readonly CcallArgumentType[],
    arguments_: readonly CcallArgument[],
  ): number;
  UTF8ToString(pointer: number): string;
  _malloc(byteLength: number): number;
  _free(pointer: number): void;
  HEAPF32: Float32Array;
}

interface EngineModuleOptions {
  readonly canvas?: HTMLCanvasElement | null;
}

type EngineModuleFactory = (
  moduleOptions?: EngineModuleOptions,
) => Promise<EngineModule>;

const DEFAULT_MODULE_URL = "../../build-wasm/engine.js";
// Matches Document::kMaxRectangles in the C++ core (P2-02).
const MAX_RECTANGLES = 50000;
const PACKED_STRIDE = 6;

// API ordinals, not design values: the C++ loader maps them to the tokens.
const TONE_ORDINALS: Readonly<Record<ToneName, number>> = {
  neutral: 0,
  "tone-a": 1,
  "tone-b": 2,
  "tone-c": 3,
  "tone-d": 4,
  "tone-e": 5,
};

const LAYER_ORDINALS: Readonly<Record<LayerName, number>> = {
  zones: 0,
  blocks: 1,
  "note-cards": 2,
};

const moduleFactories = new Map<string, Promise<EngineModuleFactory>>();
let canvasSequence = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadModuleFactory(url: URL): Promise<EngineModuleFactory> {
  const key = url.href;
  const cached = moduleFactories.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const pending = new Promise<EngineModuleFactory>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new EngineError("the engine module loader needs a browser document"));
      return;
    }
    const script = document.createElement("script");
    script.src = url.href;
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        const candidate: unknown = Reflect.get(globalThis, "createAirEngine");
        if (typeof candidate !== "function") {
          reject(new EngineError("engine.js loaded but did not expose createAirEngine"));
          return;
        }
        resolve(candidate as EngineModuleFactory);
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        reject(new EngineError(`could not load the engine module from ${url.href}`));
      },
      { once: true },
    );
    document.head.append(script);
  });
  const settled = pending.catch((error: unknown) => {
    moduleFactories.delete(key);
    throw error;
  });
  moduleFactories.set(key, settled);
  return settled;
}

function callNumber(
  module: EngineModule,
  name: string,
  argumentTypes: readonly CcallArgumentType[],
  arguments_: readonly CcallArgument[],
): number {
  return module.ccall(name, "number", argumentTypes, arguments_);
}

function lastError(module: EngineModule): string {
  return module.UTF8ToString(callNumber(module, "engine_last_error", [], []));
}

function ensureCanvasSelector(canvas: HTMLCanvasElement): string {
  if (canvas.id === "") {
    canvasSequence += 1;
    canvas.id = `air-engine-canvas-${canvasSequence}`;
  }
  return `#${CSS.escape(canvas.id)}`;
}

class WebGlEngine implements Engine {
  readonly canvas: HTMLCanvasElement;
  readonly #module: EngineModule;
  #disposed = false;

  constructor(module: EngineModule, canvas: HTMLCanvasElement) {
    this.#module = module;
    this.canvas = canvas;
  }

  loadRectangles(rectangles: readonly EngineRectangle[]): void {
    this.#assertUsable("loadRectangles");
    if (rectangles.length > MAX_RECTANGLES) {
      throw new EngineError(`at most ${MAX_RECTANGLES} rectangles are supported`);
    }
    const packed = new Float32Array(rectangles.length * PACKED_STRIDE);
    for (let index = 0; index < rectangles.length; index += 1) {
      const rectangle = rectangles[index];
      if (rectangle === undefined) {
        continue;
      }
      const offset = index * PACKED_STRIDE;
      packed[offset] = rectangle.x;
      packed[offset + 1] = rectangle.y;
      packed[offset + 2] = rectangle.width;
      packed[offset + 3] = rectangle.height;
      packed[offset + 4] = TONE_ORDINALS[rectangle.tone ?? "neutral"];
      packed[offset + 5] = LAYER_ORDINALS[rectangle.layer ?? "note-cards"];
    }
    // One explicit heap buffer: ccall arrays cannot carry a large float array
    // faithfully (and truncate it through the byte stack), so the bridge writes
    // the packed records into the wasm heap and passes the pointer.
    const pointer = this.#module._malloc(packed.byteLength);
    if (pointer === 0) {
      throw new EngineError("engine_load_rectangles: could not allocate the rectangle buffer");
    }
    try {
      this.#module.HEAPF32.set(packed, pointer / Float32Array.BYTES_PER_ELEMENT);
      this.#requireOk("engine_load_rectangles", ["number", "number"], [
        pointer,
        rectangles.length,
      ]);
    } finally {
      this.#module._free(pointer);
    }
  }

  setCamera(camera: EngineCamera): void {
    this.#assertUsable("setCamera");
    this.#requireOk("engine_set_camera", ["number", "number", "number"], [
      camera.panX,
      camera.panY,
      camera.zoom,
    ]);
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.#assertUsable("resize");
    this.canvas.width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(cssHeight * devicePixelRatio));
    this.#requireOk("engine_resize", ["number", "number", "number"], [
      cssWidth,
      cssHeight,
      devicePixelRatio,
    ]);
  }

  renderFrame(): void {
    this.#assertUsable("renderFrame");
    this.#requireOk("engine_render_frame", [], []);
  }

  lastError(): string {
    return lastError(this.#module);
  }

  dispose(): void {
    // The spike keeps one module-level GL context; dispose only stops this handle.
    this.#disposed = true;
  }

  #assertUsable(operation: string): void {
    if (this.#disposed) {
      throw new EngineError(`engine is disposed; cannot ${operation}`);
    }
  }

  #requireOk(
    name: string,
    argumentTypes: readonly CcallArgumentType[],
    arguments_: readonly CcallArgument[],
  ): void {
    if (callNumber(this.#module, name, argumentTypes, arguments_) === 0) {
      throw new EngineError(`${name} failed: ${lastError(this.#module)}`);
    }
  }
}

export async function createEngine(
  canvas: HTMLCanvasElement,
  options: EngineOptions = {},
): Promise<Engine> {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new EngineError("createEngine needs an HTMLCanvasElement");
  }
  const moduleUrl = new URL(
    options.moduleUrl ?? DEFAULT_MODULE_URL,
    import.meta.url,
  );
  const factory = await loadModuleFactory(moduleUrl);
  let module: EngineModule;
  try {
    module = await factory({ canvas });
  } catch (error: unknown) {
    throw new EngineError(`engine module failed to start: ${errorMessage(error)}`);
  }
  const selector = ensureCanvasSelector(canvas);
  if (callNumber(module, "engine_create", ["string"], [selector]) === 0) {
    throw new EngineError(`engine_create failed: ${lastError(module)}`);
  }
  return new WebGlEngine(module, canvas);
}
