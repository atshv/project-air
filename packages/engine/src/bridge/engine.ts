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

/** World-space geometry of one engine object, in the contract's pixels. */
export interface EngineGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EngineRectangle extends EngineGeometry {
  readonly tone?: ToneName;
  readonly layer?: LayerName;
}

export interface EngineCamera {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

/** Viewport size in CSS pixels for the L19 fit helper. */
export interface EngineViewport {
  readonly width: number;
  readonly height: number;
}

export interface EngineOptions {
  /** URL of the Emscripten engine.js; defaults to the build-wasm artifact. */
  readonly moduleUrl?: string | URL;
}

export interface Engine {
  readonly canvas: HTMLCanvasElement;
  /**
   * Replaces the document content. Every slot handle returned by `addRectangle`
   * is invalidated, even when the new content happens to reuse the same slots; a
   * rejected load throws and leaves the current document and handles unchanged.
   */
  loadRectangles(rectangles: readonly EngineRectangle[]): void;
  /**
   * Adds one object without reloading the document and returns its document slot
   * index. Mutations and `hitTest` address live objects by that index. The handle
   * is valid until its object is removed or `loadRectangles` replaces the
   * document; a removed object's slot may be reused by a later insert.
   */
  addRectangle(rectangle: EngineRectangle): number;
  updateGeometry(index: number, geometry: EngineGeometry): void;
  updateZ(index: number, z: string): void;
  removeObject(index: number): void;
  /**
   * Topmost live object at the screen point in draw order, as a slot index, or
   * -1 when no object is hit. A non-finite point throws; an engine-level
   * rejection reports -1 and leaves the reason in `lastError()`.
   */
  hitTest(screenX: number, screenY: number): number;
  /** Instances the current document, camera and viewport render. */
  visibleInstanceCount(): number;
  /**
   * Fits a world rectangle (the board's world bounds) into a viewport (L19) and
   * returns the pan and zoom to apply with `setCamera`: zoom at most 100 % and
   * never below the engine camera minimum, with the L02 top padding (bar 48 px +
   * 16 px) kept free above the content. Empty or invalid bounds return the world
   * origin at 100 %. The rule lives in the C++ core, so the host app never keeps
   * a second copy of it.
   */
  fitView(bounds: EngineGeometry, viewport: EngineViewport): EngineCamera;
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
  HEAPF64: Float64Array;
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

  addRectangle(rectangle: EngineRectangle): number {
    this.#assertUsable("addRectangle");
    const index = callNumber(
      this.#module,
      "engine_add_rectangle",
      ["number", "number", "number", "number", "number", "number"],
      [
        rectangle.x,
        rectangle.y,
        rectangle.width,
        rectangle.height,
        TONE_ORDINALS[rectangle.tone ?? "neutral"],
        LAYER_ORDINALS[rectangle.layer ?? "note-cards"],
      ],
    );
    if (index < 0) {
      throw new EngineError(`engine_add_rectangle failed: ${lastError(this.#module)}`);
    }
    return index;
  }

  updateGeometry(index: number, geometry: EngineGeometry): void {
    this.#assertUsable("updateGeometry");
    this.#requireOk("engine_update_geometry", ["number", "number", "number", "number", "number"], [
      index,
      geometry.x,
      geometry.y,
      geometry.width,
      geometry.height,
    ]);
  }

  updateZ(index: number, z: string): void {
    this.#assertUsable("updateZ");
    this.#requireOk("engine_update_z", ["number", "string"], [index, z]);
  }

  removeObject(index: number): void {
    this.#assertUsable("removeObject");
    this.#requireOk("engine_remove_object", ["number"], [index]);
  }

  hitTest(screenX: number, screenY: number): number {
    this.#assertUsable("hitTest");
    // The C ABI rejects a non-finite point with -1 and an error; validating here
    // keeps the typed method's one-number contract unambiguous.
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      throw new EngineError("hitTest needs a finite screen point");
    }
    const index = callNumber(this.#module, "engine_hit_test", ["number", "number"], [
      screenX,
      screenY,
    ]);
    if (!Number.isInteger(index) || index < -1) {
      throw new EngineError(`engine_hit_test failed: ${lastError(this.#module)}`);
    }
    return index;
  }

  visibleInstanceCount(): number {
    this.#assertUsable("visibleInstanceCount");
    const count = callNumber(this.#module, "engine_visible_instance_count", [], []);
    if (count < 0) {
      throw new EngineError(
        `engine_visible_instance_count failed: ${lastError(this.#module)}`,
      );
    }
    return count;
  }

  fitView(bounds: EngineGeometry, viewport: EngineViewport): EngineCamera {
    this.#assertUsable("fitView");
    const resultValues = 3;
    const pointer = this.#module._malloc(resultValues * Float64Array.BYTES_PER_ELEMENT);
    if (pointer === 0) {
      throw new EngineError("engine_fit_view: could not allocate the result buffer");
    }
    try {
      const succeeded = callNumber(
        this.#module,
        "engine_fit_view",
        ["number", "number", "number", "number", "number", "number", "number"],
        [
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          viewport.width,
          viewport.height,
          pointer,
        ],
      );
      if (succeeded === 0) {
        throw new EngineError(`engine_fit_view failed: ${lastError(this.#module)}`);
      }
      const offset = pointer / Float64Array.BYTES_PER_ELEMENT;
      const panX = this.#module.HEAPF64[offset];
      const panY = this.#module.HEAPF64[offset + 1];
      const zoom = this.#module.HEAPF64[offset + 2];
      if (panX === undefined || panY === undefined || zoom === undefined) {
        throw new EngineError("engine_fit_view: the result buffer was not readable");
      }
      return { panX, panY, zoom };
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
