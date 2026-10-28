// Thin TypeScript bridge over the engine WebAssembly module (P2-03).
//
// It loads the Emscripten-generated engine.js, starts the module with the target
// canvas, calls the small exported C API and turns failures into EngineError.
// The bridge owns no visual values: tones and layers travel as ordinals and the
// C++ side maps them to packages/ui-kit tokens. Text (P4-08) follows the same
// rule: the glyph atlas is rasterised here with the token typography the C ABI
// reports (see text-atlas.ts) and uploaded to the core in one call.

import {
  atlasRasterScale,
  codePointsOf,
  defaultCodePoints,
  METRICS_STRIDE,
  rasterizeTextAtlas,
  TEXT_ROLE_ORDINALS,
  type TextAtlasPlan,
  type TextAtlasPort,
  type TextAtlasRequest,
  type TextRoleName,
  type TextRoleStyle,
} from "./text-atlas.js";

export type { TextRoleName } from "./text-atlas.js";

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

/**
 * A world-anchored line of text: (x, y) is the top-left of the line box in world
 * px. Glyphs are placed by advance only (P4-08); layout and ellipsis are P4-09.
 */
/**
 * Layout of a run (P4-09): `line` places glyphs by advance only; `ellipsis`
 * keeps one line and cuts it to the box width with U+2026; `wrap` breaks words
 * inside the box width, clips lines beyond its height and ends the last visible
 * line with U+2026. Ordinals match TextFlow in text.h.
 */
export type TextFlowName = "line" | "ellipsis" | "wrap";

const TEXT_FLOW_ORDINALS: Readonly<Record<TextFlowName, number>> = {
  line: 0,
  ellipsis: 1,
  wrap: 2,
};

/** Layout box of a run in world (CSS) px; required for `ellipsis` and `wrap`. */
export interface EngineTextBox {
  readonly width: number;
  /** Ignored by `ellipsis`; the visible lines of `wrap` are floor(height / line height). */
  readonly height: number;
}

export interface EngineTextRun {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly role?: TextRoleName;
  readonly flow?: TextFlowName;
  readonly box?: EngineTextBox;
}

/** Presentation text of one object (L02/P4-10): a title and a short preview. */
export interface EngineObjectText {
  /** Single-line title; cut with an ellipsis at the token 15 px / 600 title role. */
  readonly title?: string;
  /** Short preview; wrapped inside the object and clipped to its own height. */
  readonly preview?: string;
}

/** Orientation of one L07 snap guide (P4-15). */
export type SnapGuideOrientation = "vertical" | "horizontal";

/**
 * One L07 guide line in world px (P4-15): a vertical line at world `position`
 * with the world span `start`..`end`, or a horizontal line at world `position`
 * with the world x span. The span is continuous across the dragged and the
 * matched element plus 16 px.
 */
export interface EngineSnapGuide {
  readonly orientation: SnapGuideOrientation;
  readonly position: number;
  readonly start: number;
  readonly end: number;
}

/** Result of one L07 snap request: the snapped world top-left and up to three guides. */
export interface EngineSnapResult {
  readonly position: { readonly x: number; readonly y: number };
  readonly guides: readonly EngineSnapGuide[];
}

/** Result of `buildTextAtlas`: the uploaded atlas size and raster scale. */
export interface EngineTextAtlas {
  readonly width: number;
  readonly height: number;
  readonly rasterScale: number;
  readonly glyphCount: number;
  readonly maxTextureSize: number;
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
  /**
   * Rasterises the default glyph set (ASCII, Latin-1, one placeholder per role)
   * with the token font stack at the current device pixel ratio and uploads it.
   * Once built, `resize` rebuilds it whenever the device pixel ratio changes.
   */
  buildTextAtlas(): EngineTextAtlas;
  /**
   * Adds a glyph run; a code point outside the atlas draws the placeholder. A
   * `flow` other than `line` needs a `box` and is laid out once per atlas build
   * inside the engine (no per-glyph call).
   */
  addTextRun(run: EngineTextRun): void;
  clearTextRuns(): void;
  /**
   * Binds presentation text to the live object at slot `index` (L02/P4-10): the
   * title is drawn in one line with an ellipsis at the token title typography and
   * the preview is wrapped and clipped inside the object. The text stays
   * presentation input — the engine document keeps no note content (AD-4) — and
   * is keyed by the object's stable id, so a reload drops it. Only visible
   * objects are laid out. Empty strings clear that object's text.
   */
  bindObjectText(index: number, text: EngineObjectText): void;
  /** Drops every bound title and preview. */
  clearObjectText(): void;
  /**
   * Height in world px the object needs so its bound preview is not clipped: the
   * L02 header/inset chrome plus the laid-out preview plus the bottom padding. A
   * block grows to this height instead of gaining an inner scrollbar. Requires a
   * built atlas for a non-empty preview.
   */
  requiredTextHeight(index: number): number;
  /**
   * L07 (P4-15): snaps the dragged object's world top-left with the pure native
   * core. Candidates are the left/centre/right and top/middle/bottom lines of
   * visible neighbours and zones within the token 6 px screen tolerance; a line
   * match beats the 16 px grid and `free` (Shift) bypasses both. Returns the
   * position to preview/commit and the guides the chrome pass draws (at most
   * three). Call it only while a drag is in progress.
   */
  snapDrag(
    index: number,
    position: { readonly x: number; readonly y: number },
    free: boolean,
  ): EngineSnapResult;
  /** Clears the snap guides (a drag ended, was cancelled or is no longer live). */
  clearSnapGuides(): void;
  /**
   * Atlas zoom bucket of the current camera (P4-10): the atlas re-rasterises only
   * when `setCamera`/`resize` cross a bucket, so text stays sharp when zooming in
   * with a bounded number of rebuilds.
   */
  atlasRasterScale(): number;
  /** Glyph quads the current runs, bindings, atlas, camera and viewport draw. */
  visibleGlyphCount(): number;
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
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
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
  #devicePixelRatio = 1;
  #zoom = 1;
  #atlasRasterScale: number | null = null;

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
    this.#zoom = camera.zoom;
    // L02 sharp zoom (P4-10): a zoom bucket change re-rasterises the atlas once;
    // panning and a zoom inside the same bucket do not touch it.
    if (this.#atlasRasterScale !== null) {
      const rasterScale = atlasRasterScale(this.#devicePixelRatio, this.#zoom);
      if (rasterScale !== this.#atlasRasterScale) {
        this.buildTextAtlas();
      }
    }
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
    this.#devicePixelRatio = devicePixelRatio;
    // ADR-0009: the atlas follows the device pixel ratio; with the P4-10 zoom
    // bucket it follows the bucket too, so text stays crisp when a window moves
    // to another display or the camera crosses a bucket.
    if (this.#atlasRasterScale !== null) {
      const rasterScale = atlasRasterScale(this.#devicePixelRatio, this.#zoom);
      if (rasterScale !== this.#atlasRasterScale) {
        this.buildTextAtlas();
      }
    }
  }

  buildTextAtlas(): EngineTextAtlas {
    this.#assertUsable("buildTextAtlas");
    const maxTextureSize = callNumber(this.#module, "engine_text_max_texture_size", [], []);
    if (maxTextureSize <= 0) {
      throw new EngineError(`engine_text_max_texture_size failed: ${lastError(this.#module)}`);
    }
    const port: TextAtlasPort = {
      style: (role) => this.#textStyle(role),
      plan: (request) => this.#planAtlas(request, maxTextureSize),
    };
    // L02 sharp zoom: the raster scale is the DPR times the current zoom bucket,
    // so the 200 % view samples a 2x atlas instead of the blurry 1x one.
    const rasterScale = atlasRasterScale(this.#devicePixelRatio, this.#zoom);
    const atlas = rasterizeTextAtlas(port, defaultCodePoints(), rasterScale);
    const module = this.#module;
    const pixelPointer = module._malloc(atlas.pixels.byteLength);
    const metricsPointer = module._malloc(atlas.metrics.byteLength);
    try {
      if (pixelPointer === 0 || metricsPointer === 0) {
        throw new EngineError("engine_text_load_atlas: could not allocate the atlas buffers");
      }
      module.HEAPU8.set(atlas.pixels, pixelPointer);
      module.HEAPF32.set(atlas.metrics, metricsPointer / Float32Array.BYTES_PER_ELEMENT);
      this.#requireOk(
        "engine_text_load_atlas",
        ["number", "number", "number", "number", "number", "number", "number"],
        [
          atlas.plan.width,
          atlas.plan.height,
          atlas.plan.rasterScale,
          pixelPointer,
          atlas.pixels.byteLength,
          metricsPointer,
          atlas.metrics.length / METRICS_STRIDE,
        ],
      );
    } finally {
      if (pixelPointer !== 0) {
        module._free(pixelPointer);
      }
      if (metricsPointer !== 0) {
        module._free(metricsPointer);
      }
    }
    this.#atlasRasterScale = rasterScale;
    return {
      width: atlas.plan.width,
      height: atlas.plan.height,
      rasterScale: atlas.plan.rasterScale,
      glyphCount: atlas.glyphCount,
      maxTextureSize,
    };
  }

  addTextRun(run: EngineTextRun): void {
    this.#assertUsable("addTextRun");
    const codePoints = Uint32Array.from(codePointsOf(run.text));
    const role = TEXT_ROLE_ORDINALS[run.role ?? "body"];
    const module = this.#module;
    // An empty run still crosses the ABI (it is valid and draws nothing); one
    // element is allocated so the pointer is never null.
    const pointer = module._malloc(Math.max(1, codePoints.length) * Uint32Array.BYTES_PER_ELEMENT);
    if (pointer === 0) {
      throw new EngineError("engine_text_add_run: could not allocate the code points");
    }
    try {
      module.HEAPU32.set(codePoints, pointer / Uint32Array.BYTES_PER_ELEMENT);
      const flow = run.flow ?? "line";
      if (flow === "line" && run.box === undefined) {
        this.#requireOk(
          "engine_text_add_run",
          ["number", "number", "number", "number", "number"],
          [run.x, run.y, role, pointer, codePoints.length],
        );
      } else {
        if (run.box === undefined) {
          throw new EngineError(`addTextRun: the ${flow} flow needs a box`);
        }
        this.#requireOk(
          "engine_text_add_box_run",
          ["number", "number", "number", "number", "number", "number", "number", "number"],
          [
            run.x,
            run.y,
            role,
            TEXT_FLOW_ORDINALS[flow],
            run.box.width,
            run.box.height,
            pointer,
            codePoints.length,
          ],
        );
      }
    } finally {
      module._free(pointer);
    }
  }

  clearTextRuns(): void {
    this.#assertUsable("clearTextRuns");
    this.#requireOk("engine_text_clear_runs", [], []);
  }

  bindObjectText(index: number, text: EngineObjectText): void {
    this.#assertUsable("bindObjectText");
    if (!Number.isInteger(index) || index < 0) {
      throw new EngineError("bindObjectText needs a non-negative integer slot index");
    }
    const title = Uint32Array.from(codePointsOf(text.title ?? ""));
    const preview = Uint32Array.from(codePointsOf(text.preview ?? ""));
    const module = this.#module;
    // One element is allocated per string so the pointer is never null; an empty
    // string still crosses the ABI with count 0 and clears that object's text.
    const titlePointer = module._malloc(Math.max(1, title.length) * Uint32Array.BYTES_PER_ELEMENT);
    const previewPointer = module._malloc(
      Math.max(1, preview.length) * Uint32Array.BYTES_PER_ELEMENT,
    );
    try {
      if (titlePointer === 0 || previewPointer === 0) {
        throw new EngineError("engine_text_bind_object: could not allocate the code points");
      }
      module.HEAPU32.set(title, titlePointer / Uint32Array.BYTES_PER_ELEMENT);
      module.HEAPU32.set(preview, previewPointer / Uint32Array.BYTES_PER_ELEMENT);
      this.#requireOk(
        "engine_text_bind_object",
        ["number", "number", "number", "number", "number"],
        [index, titlePointer, title.length, previewPointer, preview.length],
      );
    } finally {
      if (titlePointer !== 0) {
        module._free(titlePointer);
      }
      if (previewPointer !== 0) {
        module._free(previewPointer);
      }
    }
  }

  clearObjectText(): void {
    this.#assertUsable("clearObjectText");
    this.#requireOk("engine_text_clear_bindings", [], []);
  }

  requiredTextHeight(index: number): number {
    this.#assertUsable("requiredTextHeight");
    if (!Number.isInteger(index) || index < 0) {
      throw new EngineError("requiredTextHeight needs a non-negative integer slot index");
    }
    const pointer = this.#module._malloc(Float64Array.BYTES_PER_ELEMENT);
    if (pointer === 0) {
      throw new EngineError("engine_text_required_height: could not allocate the result buffer");
    }
    try {
      this.#requireOk("engine_text_required_height", ["number", "number"], [index, pointer]);
      const offset = pointer / Float64Array.BYTES_PER_ELEMENT;
      const height = this.#module.HEAPF64[offset];
      if (height === undefined) {
        throw new EngineError("engine_text_required_height: the result buffer was not readable");
      }
      return height;
    } finally {
      this.#module._free(pointer);
    }
  }

  snapDrag(
    index: number,
    position: { readonly x: number; readonly y: number },
    free: boolean,
  ): EngineSnapResult {
    this.#assertUsable("snapDrag");
    if (!Number.isInteger(index) || index < 0) {
      throw new EngineError("snapDrag needs a non-negative integer slot index");
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new EngineError("snapDrag needs a finite world position");
    }
    const module = this.#module;
    const positionPointer = module._malloc(2 * Float64Array.BYTES_PER_ELEMENT);
    const guidePointer = module._malloc(4 * Float64Array.BYTES_PER_ELEMENT);
    if (positionPointer === 0 || guidePointer === 0) {
      if (positionPointer !== 0) {
        module._free(positionPointer);
      }
      if (guidePointer !== 0) {
        module._free(guidePointer);
      }
      throw new EngineError("engine_snap_position: could not allocate the result buffers");
    }
    try {
      const guideCount = callNumber(
        module,
        "engine_snap_position",
        ["number", "number", "number", "number", "number"],
        [index, position.x, position.y, free ? 1 : 0, positionPointer],
      );
      if (guideCount < 0) {
        throw new EngineError(`engine_snap_position failed: ${lastError(module)}`);
      }
      const positionOffset = positionPointer / Float64Array.BYTES_PER_ELEMENT;
      const x = module.HEAPF64[positionOffset];
      const y = module.HEAPF64[positionOffset + 1];
      if (x === undefined || y === undefined) {
        throw new EngineError("engine_snap_position: the result buffer was not readable");
      }
      const guideOffset = guidePointer / Float64Array.BYTES_PER_ELEMENT;
      const guides: EngineSnapGuide[] = [];
      for (let guideIndex = 0; guideIndex < guideCount; guideIndex += 1) {
        if (
          callNumber(module, "engine_snap_guide", ["number", "number"], [guideIndex, guidePointer]) !==
          1
        ) {
          throw new EngineError(`engine_snap_guide failed: ${lastError(module)}`);
        }
        const orientation = module.HEAPF64[guideOffset];
        const guidePosition = module.HEAPF64[guideOffset + 1];
        const start = module.HEAPF64[guideOffset + 2];
        const end = module.HEAPF64[guideOffset + 3];
        if (
          orientation === undefined ||
          guidePosition === undefined ||
          start === undefined ||
          end === undefined
        ) {
          throw new EngineError("engine_snap_guide: the result buffer was not readable");
        }
        guides.push({
          orientation: orientation === 0 ? "vertical" : "horizontal",
          position: guidePosition,
          start,
          end,
        });
      }
      return { position: { x, y }, guides };
    } finally {
      module._free(positionPointer);
      module._free(guidePointer);
    }
  }

  clearSnapGuides(): void {
    this.#assertUsable("clearSnapGuides");
    this.#requireOk("engine_snap_clear", [], []);
  }

  atlasRasterScale(): number {
    this.#assertUsable("atlasRasterScale");
    return atlasRasterScale(this.#devicePixelRatio, this.#zoom);
  }

  visibleGlyphCount(): number {
    this.#assertUsable("visibleGlyphCount");
    const count = callNumber(this.#module, "engine_visible_glyph_count", [], []);
    if (count < 0) {
      throw new EngineError(`engine_visible_glyph_count failed: ${lastError(this.#module)}`);
    }
    return count;
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

  #textStyle(role: number): TextRoleStyle {
    const values = this.#readDoubles(3, "engine_text_style", ["number"], [role]);
    const fontFamily = this.#module.UTF8ToString(
      callNumber(this.#module, "engine_text_font_family", ["number"], [role]),
    );
    const [fontSize, fontWeight, lineHeight] = values;
    if (fontSize === undefined || fontWeight === undefined || lineHeight === undefined) {
      throw new EngineError("engine_text_style: the result buffer was not readable");
    }
    return { fontFamily, fontSize, fontWeight, lineHeight };
  }

  #planAtlas(request: TextAtlasRequest, maxTextureSize: number): TextAtlasPlan {
    const values = this.#readDoubles(
      7,
      "engine_text_plan_atlas",
      ["number", "number", "number", "number", "number"],
      [
        request.glyphCount,
        request.cellWidth,
        request.cellHeight,
        request.devicePixelRatio,
        maxTextureSize,
      ],
    );
    const [width, height, columns, rows, cellWidth, cellHeight, rasterScale] = values;
    if (
      width === undefined ||
      height === undefined ||
      columns === undefined ||
      rows === undefined ||
      cellWidth === undefined ||
      cellHeight === undefined ||
      rasterScale === undefined
    ) {
      throw new EngineError("engine_text_plan_atlas: the result buffer was not readable");
    }
    return { width, height, columns, rows, cellWidth, cellHeight, rasterScale };
  }

  // Calls a C ABI function whose last argument is a double[count] result buffer.
  #readDoubles(
    count: number,
    name: string,
    argumentTypes: readonly CcallArgumentType[],
    arguments_: readonly CcallArgument[],
  ): number[] {
    const pointer = this.#module._malloc(count * Float64Array.BYTES_PER_ELEMENT);
    if (pointer === 0) {
      throw new EngineError(`${name}: could not allocate the result buffer`);
    }
    try {
      this.#requireOk(name, [...argumentTypes, "number"], [...arguments_, pointer]);
      const offset = pointer / Float64Array.BYTES_PER_ELEMENT;
      return Array.from(this.#module.HEAPF64.subarray(offset, offset + count));
    } finally {
      this.#module._free(pointer);
    }
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
