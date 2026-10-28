#!/usr/bin/env node
// Visual gate harness for the engine (P4-04).
//
//   node packages/engine/test/visual/run-visual.mjs
//     The `visual` gate: capture every named scene at 1440x900 and 390x844 (device
//     pixel ratio 1) in Chrome for Testing on a real GPU, compare the screenshots
//     with the committed reference images under reviews/evidence/visual-baselines/
//     and exit 0 only when every capture is within tolerance. Writes the capture
//     record to reviews/evidence/P4-04-visual-run-<timestamp>.json.
//
//   node packages/engine/test/visual/run-visual.mjs --update
//     Writes the reference images for the selected scenes/viewports. This is an
//     explicit review action: it reports `update`, never a gate pass, and a
//     reviewer must compare the old and the new images before the update is
//     accepted.
//
//   node packages/engine/test/visual/run-visual.mjs --scene <name> --viewport <name>
//     Local work: restrict the run to one or more scenes and/or one viewport.
//
//   node packages/engine/test/visual/run-visual.mjs --task <task-id>
//     Names the capture record and its `task` field after the task that runs the
//     gate (default P4-04, the gate's origin), so a later task's record does not
//     masquerade as P4-04 evidence. It changes no scene, camera or tolerance.
//
// The harness is dependency-free: Node builtins only, Chrome for Testing from the
// local Playwright cache (`CHROME_PATH` wins), the DevTools protocol over Node's
// WebSocket, and a PNG decoder/encoder built on `node:zlib` plus the five PNG
// scanline filters. It reads `ports.playground` from `.polier-slot`, copies the
// built playground, bridge, test-kit bundle and WASM into a temporary folder,
// starts and stops its own static server and browser, and removes the temporary
// folder. It never stops a process it did not start.
//
// Determinism: fixed scenes from `packages/test-kit`, deterministic camera states
// through the documented read-only `?view=<worldX>,<worldY>,<zoom>` page hook,
// exact viewports and DPR 1 through the DevTools protocol, the render loop paused
// before the screenshot, the volatile rendered-frame HUD counter hidden, fonts settled, no
// animations. Every capture log line also prints the capture URL and the effective
// camera (panX, panY, zoom), so the gate log alone documents the deterministic
// view. The reference images are the contract: a baseline change is a reviewed
// decision, not a fix for a red gate.
//
// Renderer policy (fail-closed, same as the perf harness): the renderer string is
// recorded and the run only passes when it is positively identified as a real GPU.
// A software renderer (SwiftShader/llvmpipe) or an unknown renderer makes the run
// `infra` with exit code 3, never a pass.
//
// Exit codes: 0 pass (or baselines written with --update), 1 a reference image
// differs or a capture assertion fails, 2 usage/build problem (missing artefacts,
// missing baseline, unknown filter), 3 infra (software/unknown renderer, no Chrome,
// page not ready, port busy). A record with result `infra` is not evidence.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import {
  cpus,
  homedir,
  release as osRelease,
  tmpdir,
  totalmem,
  type as osType,
  version as osVersion,
} from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, "reviews", "evidence");
const BASELINE_DIR = join(EVIDENCE_DIR, "visual-baselines");
const HARNESS_RELATIVE = "packages/engine/test/visual/run-visual.mjs";

// The capture-record prefix/report `task` field: `--task <id>` overrides it for a
// task that runs the gate, so its records do not masquerade as P4-04 evidence.
// The default P4-04 is the gate's origin and stays compatible.
let evidenceTask = "P4-04";
const GATE = "visual";
const BACKEND = "webgl2";
const BACKEND_LABEL = "WebGL2";

// Viewport set mirrored in docs/gates/visual-diff.md. The DevTools protocol sets
// the exact metrics (browser flags alone cannot: Chrome clamps --window-size) and
// the harness asserts the screenshot size instead of trusting the emulation.
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
];

// Tolerance mirrored in docs/gates/visual-diff.md. The default is an exact match:
// zero differing pixels, zero channel delta and zero differing-pixel ratio. A run
// that needs antialiasing noise must document the allowance there and in the gate
// record, and review must approve it before it is committed.
const MAX_DIFFERING_PIXELS = 0;
const MAX_DIFFERING_PIXEL_RATIO = 0;
const MAX_CHANNEL_DELTA = 0;

// Deterministic camera states mirrored in docs/gates/visual-diff.md. The sample
// board's zone-0001 centre is the anchor for both zoom states, so the pair shows
// the same section at two zoom levels: 0.5 is clearly above the fit zoom (0.15 at
// 1440x900), 0.1 is the engine camera's minimum zoom (docs/engine.md).
const SAMPLE_ZOOM_IN_ZOOM = 0.5;
const SAMPLE_ZOOM_OUT_ZOOM = 0.1;
const SAMPLE_ZOOM_ANCHOR_ID = "zone-0001";

// Engine camera clamp mirrored from docs/engine.md; the page clamps the `?view=`
// zoom with the same values, the harness asserts the effective camera.
const MINIMUM_ZOOM = 0.1;
const MAXIMUM_ZOOM = 8;

// L19 fit rule mirrored from packages/engine/src/camera.cpp and docs/engine.md:
// "show all" fits the world below the L02 top padding (bar 48 px + 16 px tokens)
// and never zooms past 100 %. The fit-action scene asserts the effective camera
// against this rule, so a broken fit helper is a capture failure instead of a
// plausible image.
const FIT_TOP_PADDING = 64;
const MAX_FIT_ZOOM = 1.0;

// Scene names the gate captures. A scene without a `view` is captured with the
// playground's own camera (the documented at-rest state); a scene with
// `fitAction` runs the L19 fit action before the capture.
const SCENE_DEFINITIONS = [
  {
    name: "sample-at-rest",
    scene: "sample",
    view: null,
    camera: "playground initial camera (plain world-centred fit, clamped to 0.1 … 8)",
  },
  {
    name: "sample-zoom-in",
    scene: "sample",
    view: { zoom: SAMPLE_ZOOM_IN_ZOOM },
    camera: "centre of zone-0001 at zoom 0.5",
  },
  {
    name: "sample-zoom-out",
    scene: "sample",
    view: { zoom: SAMPLE_ZOOM_OUT_ZOOM },
    camera: "centre of zone-0001 at the engine minimum zoom 0.1",
  },
  {
    name: "engine-core-at-rest",
    scene: "engine-core",
    view: null,
    camera: "playground initial camera (plain world-centred fit, clamped to 0.1 … 8)",
  },
  {
    // L19 fitted view: one card, so the fit action lands at exactly 100 % and the
    // dot grid (visible at and above zoom 0.5) is part of the reviewed reference image.
    name: "one-card-fit",
    scene: "stress",
    count: 1,
    view: null,
    fitAction: true,
    camera: "L19 fit action of the one-card world: centred, 100 % zoom, dot grid visible",
  },
  {
    // L13 (P4-06): zones < blocks < note cards although the stored keys say the
    // opposite; two cards share a key and the later one is on top. Loaded as
    // contract objects through the document port; storage is ignored.
    name: "layers-at-rest",
    scene: "layers",
    view: null,
    extra: { store: "off" },
    camera: "playground initial camera (plain world-centred fit) of the layers world",
  },
  {
    // L13 (P4-06): the lowest card brought to the front of its layer with one
    // reorder operation through the P4-05 seam; it never rises above its layer.
    name: "layers-front",
    scene: "layers",
    view: null,
    extra: { store: "off", front: "card-0001" },
    camera: "playground initial camera (plain world-centred fit) of the layers world",
  },
  {
    // L02 (P4-09): text layout on an empty world — a fitting title, a title cut
    // with U+2026, a zone-name box with an em dash and a wrapped preview clipped
    // to three lines with a hard break; the layout runs inside the engine.
    name: "text-layout",
    scene: "stress",
    count: 0,
    view: { worldX: 272, worldY: 112, zoom: 1 },
    extra: { text: "layout" },
    camera: "world (272, 112) at zoom 1 (the atlas raster scale; zoom re-rasterisation is P4-10)",
  },
  {
    // L02 (P4-10): the playground's deterministic titles gallery (2 zones, 2
    // blocks, 4 cards). Zone names and card titles are ellipsis runs at 15 px/600,
    // block previews wrap and clip, the block grows to its preview height, the
    // zone content starts at the 40 + 16 px inset and the header chrome marks the
    // 40 px band. Captured at 100 %, the atlas raster scale of zoom 1.
    name: "text-titles",
    scene: "titles",
    view: { worldX: 512, worldY: 288, zoom: 1 },
    extra: { text: "titles" },
    expectedCounts: { zones: 2, blocks: 2, cards: 4, total: 8 },
    expectedWorld: { width: 1024, height: 576 },
    camera: "titles gallery centred at world (512, 288) at zoom 1 (100 %)",
  },
  {
    // L08 (P4-30): deterministic grouping ghost frame and landing slot.
    name: "zone-grouping-ghost",
    scene: "layers",
    view: { worldX: 512, worldY: 288, zoom: 1 },
    extra: { store: "off", zoneLifecycle: "grouping" },
    expectedCounts: { zones: 2, blocks: 2, cards: 4, total: 8 },
    expectedWorld: { width: 1024, height: 576 },
    camera: "layers world at (512, 288) zoom 1 with the grouping ghost frame",
  },
  {
    // L08 (P4-30): deterministic emptied-zone (dashed, dimmed) frame.
    name: "zone-emptied",
    scene: "layers",
    view: { worldX: 512, worldY: 288, zoom: 1 },
    extra: { store: "off", zoneLifecycle: "emptied" },
    expectedCounts: { zones: 2, blocks: 2, cards: 4, total: 8 },
    expectedWorld: { width: 1024, height: 576 },
    camera: "layers world at (512, 288) zoom 1 with the emptied-zone frame",
  },
  {
    // L08 (P4-30): deterministic zone title in the 40 px header.
    name: "zone-names",
    scene: "layers",
    view: { worldX: 512, worldY: 288, zoom: 1 },
    extra: { store: "off", zoneLifecycle: "names" },
    expectedCounts: { zones: 2, blocks: 2, cards: 4, total: 8 },
    expectedWorld: { width: 1024, height: 576 },
    camera: "layers world at (512, 288) zoom 1 with the zone title header",
  },
  {
    // L08 (P4-29): deterministic zone parity at rest — the auto-arranged members
    // (vertical, sizes + 16 px padding + 12 px gap below the 40 px header) and
    // the dashed landing slot of the release preview. Page-owned deterministic
    // demo on the layers scene at 100 %.
    name: "zone-parity-at-rest",
    scene: "layers",
    view: { worldX: 512, worldY: 288, zoom: 1 },
    extra: { store: "off", zoneParity: "1" },
    expectedCounts: { zones: 2, blocks: 2, cards: 4, total: 8 },
    expectedWorld: { width: 1024, height: 576 },
    camera: "layers world centred at (512, 288) at zoom 1 with the arranged zone and landing slot",
  },
  {
    // L02 (P4-10): the same gallery zoomed to 200 % — the zoom bucket re-rasterises
    // the atlas at twice the CSS resolution, so text stays sharp instead of
    // upscaling the 100 % atlas.
    name: "text-titles-zoom-200",
    scene: "titles",
    view: { worldX: 512, worldY: 240, zoom: 2 },
    extra: { text: "titles" },
    expectedCounts: { zones: 2, blocks: 2, cards: 4, total: 8 },
    expectedWorld: { width: 1024, height: 576 },
    camera: "titles gallery header at world (512, 240) at zoom 2 (200 %, the sharp bucket)",
  },
];

const PAGE_TIMEOUT_MS = 30000;
const CAPTURE_SETTLE_MS = 150;

// Chrome for Testing flags: the perf-baseline flags plus `--no-sandbox`, the local
// flag documented in docs/gates/perf.md and docs/gates/visual-diff.md. Chrome's own
// sandbox cannot initialise inside the sandboxed harness environment
// ("sandbox initialization failed: Operation not permitted"); the flag is local to
// this tool, never shipped, and does not touch the renderer check.
const BASE_CHROME_FLAGS = [
  "--headless=new",
  "--use-angle=metal",
  "--enable-gpu",
  "--hide-scrollbars",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--window-size=1440,900",
];
const CHROME_FLAGS = [...BASE_CHROME_FLAGS, "--no-sandbox"];

// Documented local default: the Chrome for Testing binary in the Playwright cache
// of the measurement machine. CHROME_PATH always wins and the source is recorded.
const LOCAL_CHROME_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

// Fail-closed renderer policy, shared with the perf harness.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;
const REAL_GPU_ANGLE = /^ANGLE \(/i;
const REAL_GPU_HINTS = /(apple|metal|opengl|vulkan|nvidia|amd|intel|geforce|radeon)/i;

const RENDERER_EXPRESSION = `(() => {
  const canvas = document.querySelector("#canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return "unavailable";
  }
  const gl = canvas.getContext("webgl2");
  if (gl === null) {
    return "unavailable";
  }
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  if (extension === null) {
    return "unknown";
  }
  return String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));
})()`;

// Hides the volatile rendered-frame HUD value before the screenshot: the counter
// and its item are removed from the layout (`display: none`), so neither the
// number nor the empty label is part of the reference image. The object, card,
// zone and visible counts are deterministic for a fixed scene and camera.
const HIDE_VOLATILE_HUD_EXPRESSION = `(() => {
  const frames = document.querySelector("#frames");
  const item = frames === null ? null : frames.closest(".hud__item") ?? frames;
  if (item instanceof HTMLElement) {
    item.style.setProperty("display", "none");
  }
  return true;
})()`;

// Waits for web fonts and two animation frames after the loop is paused, so the
// captured compositor frame is the settled one.
const SETTLE_EXPRESSION = `new Promise((resolve) => {
  const frames = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  };
  if (document.fonts !== undefined && document.fonts.ready !== undefined) {
    document.fonts.ready.then(frames, frames);
  } else {
    frames();
  }
})`;

// Runs the L19 fit action ("show all") and waits until the frame it requested has
// been drawn: on-demand rendering draws exactly one frame per change, so the
// rendered-frame counter must advance. Returns the counter and the effective
// camera for the capture record.
const FIT_ACTION_EXPRESSION = `new Promise((resolve) => {
  const before = globalThis.__enginePlayground.frameCount();
  globalThis.__enginePlayground.fit();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(JSON.stringify({
    framesBefore: before,
    framesAfter: globalThis.__enginePlayground.frameCount(),
    camera: globalThis.__enginePlayground.getState().camera
  }))));
})`;

const LAYOUT_EXPRESSION = `(() => {
  const canvas = document.querySelector("#canvas");
  const bounds = canvas === null ? null : canvas.getBoundingClientRect();
  const text = (selector) => document.querySelector(selector)?.textContent ?? null;
  return JSON.stringify({
    state: globalThis.__enginePlayground.getState(),
    inner: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
    canvas: bounds === null ? null : {
      cssWidth: Math.round(bounds.width),
      cssHeight: Math.round(bounds.height),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
    },
    hud: {
      objects: text("#hud-objects"),
      cards: text("#hud-cards"),
      zones: text("#hud-zones"),
      visible: text("#hud-visible"),
      backend: text("#hud-backend")
    },
    caption: text("#scene-caption"),
    error: text("#error") ?? "",
    errorHidden: document.querySelector("#error")?.hidden ?? null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth
  });
})()`;

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

class HarnessError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "HarnessError";
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new HarnessError(message, exitCode);
}

// ---------------------------------------------------------------------------
// PNG codec: decode/encode RGBA8 with node:zlib and the five scanline filters.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) {
    return left;
  }
  if (distanceUp <= distanceUpperLeft) {
    return up;
  }
  return upperLeft;
}

function unfilterByte(filterType, raw, left, up, upperLeft) {
  switch (filterType) {
    case 0:
      return raw;
    case 1:
      return raw + left;
    case 2:
      return raw + up;
    case 3:
      return raw + Math.floor((left + up) / 2);
    case 4:
      return raw + paethPredictor(left, up, upperLeft);
    default:
      throw new Error(`unsupported PNG filter type ${filterType}`);
  }
}

function filterByte(filterType, value, left, up, upperLeft) {
  switch (filterType) {
    case 0:
      return value;
    case 1:
      return value - left;
    case 2:
      return value - up;
    case 3:
      return value - Math.floor((left + up) / 2);
    case 4:
      return value - paethPredictor(left, up, upperLeft);
    default:
      throw new Error(`unsupported PNG filter type ${filterType}`);
  }
}

function findChunk(buffer, type, startOffset) {
  let offset = startOffset;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    if (buffer.length < offset + 12 + length) {
      throw new Error(`truncated PNG chunk ${chunkType}`);
    }
    if (chunkType === type) {
      return { offset, length };
    }
    offset += 12 + length;
  }
  return null;
}

/**
 * Decodes a PNG screenshot or reference image to 8-bit RGBA.
 * Supported: bit depth 8, interlace 0, colour types 0/2/4/6 (grey, RGB, grey+alpha,
 * RGBA). Palette images and 16-bit images are rejected instead of guessed.
 */
function decodePng(buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG file");
  }
  const header = findChunk(buffer, "IHDR", 8);
  if (header === null) {
    throw new Error("PNG has no IHDR chunk");
  }
  const width = buffer.readUInt32BE(header.offset + 8);
  const height = buffer.readUInt32BE(header.offset + 12);
  const bitDepth = buffer[header.offset + 16];
  const colorType = buffer[header.offset + 17];
  const compression = buffer[header.offset + 18];
  const filterMethod = buffer[header.offset + 19];
  const interlace = buffer[header.offset + 20];
  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}; expected 8`);
  }
  if (compression !== 0 || filterMethod !== 0) {
    throw new Error("unsupported PNG compression or filter method");
  }
  if (interlace !== 0) {
    throw new Error("interlaced PNG is not supported");
  }
  let channels;
  switch (colorType) {
    case 0:
      channels = 1;
      break;
    case 2:
      channels = 3;
      break;
    case 4:
      channels = 2;
      break;
    case 6:
      channels = 4;
      break;
    default:
      throw new Error(`unsupported PNG colour type ${colorType}`);
  }

  const idatChunks = [];
  let offset = 8;
  let sawEnd = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error(`truncated PNG chunk ${type}`);
    }
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const typeBytes = buffer.subarray(offset + 4, dataStart);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    if (expectedCrc !== actualCrc) {
      throw new Error(`PNG chunk ${type} has a bad CRC`);
    }
    if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = dataEnd + 4;
  }
  if (!sawEnd) {
    throw new Error("PNG has no IEND chunk");
  }
  if (idatChunks.length === 0) {
    throw new Error("PNG has no image data");
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rowBytes = width * channels;
  const expectedBytes = height * (rowBytes + 1);
  if (inflated.length < expectedBytes) {
    throw new Error(`PNG image data is truncated (${inflated.length} of ${expectedBytes} bytes)`);
  }
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(rowBytes);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[inputOffset];
    inputOffset += 1;
    const current = Buffer.alloc(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const raw = inflated[inputOffset + index];
      const left = index >= channels ? current[index - channels] : 0;
      const up = previous[index];
      const upperLeft = index >= channels ? previous[index - channels] : 0;
      current[index] = unfilterByte(filterType, raw, left, up, upperLeft) & 0xff;
    }
    inputOffset += rowBytes;
    for (let pixel = 0; pixel < width; pixel += 1) {
      const source = pixel * channels;
      const destination = (row * width + pixel) * 4;
      switch (channels) {
        case 1:
          rgba[destination] = current[source];
          rgba[destination + 1] = current[source];
          rgba[destination + 2] = current[source];
          rgba[destination + 3] = 255;
          break;
        case 2:
          rgba[destination] = current[source];
          rgba[destination + 1] = current[source];
          rgba[destination + 2] = current[source];
          rgba[destination + 3] = current[source + 1];
          break;
        case 3:
          rgba[destination] = current[source];
          rgba[destination + 1] = current[source + 1];
          rgba[destination + 2] = current[source + 2];
          rgba[destination + 3] = 255;
          break;
        default:
          rgba[destination] = current[source];
          rgba[destination + 1] = current[source + 1];
          rgba[destination + 2] = current[source + 2];
          rgba[destination + 3] = current[source + 3];
          break;
      }
    }
    previous = current;
  }
  return { width, height, rgba };
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

/**
 * Encodes RGBA8 pixels as a PNG. `filterTypes` is a per-row array of PNG filter
 * types (default: Paeth, filter 4, on every row) and exists so the codec
 * self-test can exercise all five filters.
 */
function encodePng({ width, height, rgba, filterTypes = null }) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  let previous = Buffer.alloc(rowBytes);
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * rowBytes;
    const outputOffset = row * (rowBytes + 1);
    const filterType =
      filterTypes === null ? 4 : Number.isInteger(filterTypes[row]) ? filterTypes[row] : 0;
    raw[outputOffset] = filterType;
    for (let index = 0; index < rowBytes; index += 1) {
      const value = rgba[rowOffset + index];
      const left = index >= 4 ? rgba[rowOffset + index - 4] : 0;
      const up = previous[index];
      const upperLeft = index >= 4 ? previous[index - 4] : 0;
      raw[outputOffset + 1 + index] = filterByte(filterType, value, left, up, upperLeft) & 0xff;
    }
    previous = rgba.subarray(rowOffset, rowOffset + rowBytes);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Proves the codec before it is used for the gate: encodes known pixels with every
 * scanline filter, decodes them again and fails loudly when a pixel or a filter is
 * wrong. A wrong filter implementation would silently compare garbage.
 */
function assertPngCodec() {
  const width = 3;
  const height = 2;
  const rgba = Buffer.from([
    0, 10, 20, 255, 30, 40, 50, 255, 60, 70, 80, 255, 90, 100, 110, 255, 120, 130, 140, 255, 150,
    160, 170, 255,
  ]);
  const filterSets = [null, [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [0, 4]];
  for (const filterTypes of filterSets) {
    const encoded = encodePng({ width, height, rgba, filterTypes });
    const decoded = decodePng(encoded);
    if (decoded.width !== width || decoded.height !== height) {
      throw new Error("png self-test: round trip changed the image size");
    }
    if (!decoded.rgba.equals(rgba)) {
      throw new Error(
        `png self-test: round trip changed pixels (filters ${filterTypes === null ? "default" : filterTypes.join(",")})`,
      );
    }
  }
  if (decodePng(encodePng({ width, height, rgba })).rgba.equals(rgba) === false) {
    throw new Error("png self-test: default encode/decode mismatch");
  }
  return filterSets.length;
}

// ---------------------------------------------------------------------------
// Image comparison and diff images.
// ---------------------------------------------------------------------------

function compareImages(reference, current) {
  const dimensionMismatch = reference.width !== current.width || reference.height !== current.height;
  const totalPixels = current.width * current.height;
  if (dimensionMismatch) {
    return {
      dimensionMismatch,
      referenceWidth: reference.width,
      referenceHeight: reference.height,
      capturedWidth: current.width,
      capturedHeight: current.height,
      totalPixels,
      differingPixels: totalPixels,
      differingPixelRatio: 1,
      worstChannelDelta: 255,
      withinTolerance: false,
    };
  }
  let differingPixels = 0;
  let worstChannelDelta = 0;
  for (let offset = 0; offset < current.rgba.length; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(reference.rgba[offset + channel] - current.rgba[offset + channel]);
      if (delta > worstChannelDelta) {
        worstChannelDelta = delta;
      }
      if (delta > 0) {
        pixelDiffers = true;
      }
    }
    if (pixelDiffers) {
      differingPixels += 1;
    }
  }
  const differingPixelRatio = totalPixels === 0 ? 0 : differingPixels / totalPixels;
  const withinTolerance =
    differingPixels <= MAX_DIFFERING_PIXELS &&
    differingPixelRatio <= MAX_DIFFERING_PIXEL_RATIO &&
    worstChannelDelta <= MAX_CHANNEL_DELTA;
  return {
    dimensionMismatch,
    referenceWidth: reference.width,
    referenceHeight: reference.height,
    capturedWidth: current.width,
    capturedHeight: current.height,
    totalPixels,
    differingPixels,
    differingPixelRatio,
    worstChannelDelta,
    withinTolerance,
  };
}

/**
 * Writes the diff image for a failing capture: the current pixels with every pixel
 * that differs from the reference marked red. Returns the evidence-relative path.
 */
function writeDiffPng(current, reference, relativeName) {
  const pixels = Buffer.from(current.rgba);
  if (reference.width === current.width && reference.height === current.height) {
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const differs =
        pixels[offset] !== reference.rgba[offset] ||
        pixels[offset + 1] !== reference.rgba[offset + 1] ||
        pixels[offset + 2] !== reference.rgba[offset + 2] ||
        pixels[offset + 3] !== reference.rgba[offset + 3];
      if (differs) {
        pixels[offset] = 255;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 255;
      }
    }
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const absolute = join(EVIDENCE_DIR, relativeName);
  writeFileSync(
    absolute,
    encodePng({ width: current.width, height: current.height, rgba: pixels }),
  );
  return absolute;
}

// ---------------------------------------------------------------------------
// Repo, slot, artefacts and static server.
// ---------------------------------------------------------------------------

function readSlotPort(service = "playground") {
  const slotPath = join(REPO_ROOT, ".polier-slot");
  if (!existsSync(slotPath)) {
    fail(`missing ${slotPath}; acquire a Polier slot for this worktree first`);
  }
  let slot;
  try {
    slot = JSON.parse(readFileSync(slotPath, "utf8"));
  } catch {
    fail(`${slotPath} is not valid JSON`);
  }
  const port = slot?.ports?.[service];
  if (!Number.isInteger(port)) {
    fail(`${slotPath} has no integer ports.${service}`);
  }
  return port;
}

// The logic layer's browser build (P4-06): the layers scene applies its front
// operation through the seam, so the copied page needs the whole directory.
const LOGIC_BUILD_DIR = "packages/engine/dist/logic";

const REQUIRED_ARTEFACTS = [
  `${LOGIC_BUILD_DIR}/packages/engine/src/logic/operations.js`,
  "apps/engine-playground/index.html",
  "apps/engine-playground/main.js",
  "apps/engine-playground/playground.css",
  "packages/ui-kit/tokens.css",
  "packages/engine/dist/bridge/engine.js",
  "packages/engine/dist/bridge/text-atlas.js",
  "packages/engine/dist/bridge/input.js",
  "packages/engine/dist/bridge/overlay.js",
  "packages/engine/dist/bridge/zone-parity.js",
  "packages/engine/dist/bridge/zone-lifecycle.js",
  "packages/engine/build-wasm/engine.js",
  "packages/engine/build-wasm/engine.wasm",
  "packages/test-kit/dist/scenes.js",
];

function ensureArtefacts() {
  const missing = REQUIRED_ARTEFACTS.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
  if (missing.length > 0) {
    fail(
      `missing build artefacts: ${missing.join(", ")}; run "pnpm --filter @project-air/engine run build", "bash packages/engine/tools/build-wasm.sh" and "pnpm --filter @project-air/test-kit run build" first`,
    );
  }
}

function copyArtefacts(tempRoot) {
  cpSync(join(REPO_ROOT, "apps/engine-playground"), join(tempRoot, "apps/engine-playground"), {
    recursive: true,
  });
  const files = [
    "packages/ui-kit/tokens.css",
    "packages/engine/dist/bridge/engine.js",
    "packages/engine/dist/bridge/text-atlas.js",
    "packages/engine/dist/bridge/input.js",
    "packages/engine/dist/bridge/overlay.js",
    "packages/engine/dist/bridge/zone-parity.js",
    "packages/engine/dist/bridge/zone-lifecycle.js",
    "packages/engine/build-wasm/engine.js",
    "packages/engine/build-wasm/engine.wasm",
    "packages/test-kit/dist/scenes.js",
  ];
  for (const relative of files) {
    const destination = join(tempRoot, relative);
    mkdirSync(join(destination, ".."), { recursive: true });
    cpSync(join(REPO_ROOT, relative), destination);
  }
  cpSync(join(REPO_ROOT, LOGIC_BUILD_DIR), join(tempRoot, LOGIC_BUILD_DIR), { recursive: true });
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function startStaticServer(tempRoot, port) {
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) {
        pathname += "index.html";
      }
      const filePath = resolve(tempRoot, `.${pathname}`);
      if (!filePath.startsWith(resolve(tempRoot) + "/")) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const body = readFileSync(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        rejectServer(
          new HarnessError(
            `port ${port} is already in use; the visual gate is exclusive, rerun it alone`,
            3,
          ),
        );
        return;
      }
      rejectServer(error);
    });
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

// ---------------------------------------------------------------------------
// Browser: Chrome for Testing from the local Playwright cache.
// ---------------------------------------------------------------------------

function findChrome() {
  const candidates = [];
  const override = process.env.CHROME_PATH;
  if (typeof override === "string" && override.length > 0) {
    candidates.push({ path: override, source: "CHROME_PATH" });
  }
  if (existsSync(LOCAL_CHROME_CACHE)) {
    for (const entry of readdirSync(LOCAL_CHROME_CACHE).sort()) {
      if (!entry.startsWith("chromium-")) {
        continue;
      }
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
        candidates.push({
          path: join(
            LOCAL_CHROME_CACHE,
            entry,
            arch,
            "Google Chrome for Testing.app",
            "Contents",
            "MacOS",
            "Google Chrome for Testing",
          ),
          source: "local Playwright cache default",
        });
      }
    }
  }
  candidates.push({
    path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    source: "Applications fallback",
  });
  candidates.push({
    path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
    source: "Applications fallback",
  });
  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return candidate;
    }
  }
  fail("no Chrome found; set CHROME_PATH to a Chrome for Testing binary", 3);
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForDebugPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page !== undefined) {
          return page;
        }
      }
    } catch {
      // not up yet
    }
    await delay(200);
  }
  fail(`Chrome debug port ${port} did not expose a page target`, 3);
}

function cdpClient(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  return (method, params = {}) =>
    new Promise((resolveCall) => {
      nextId += 1;
      pending.set(nextId, resolveCall);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
}

function waitForExit(processHandle, timeoutMs) {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

async function launchChrome({ chrome, tempRoot, stderrLines }) {
  const debugPort = await getFreePort();
  const userDataDir = join(tempRoot, "chrome-profile");
  const child = spawn(
    chrome.path,
    [
      ...CHROME_FLAGS,
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${debugPort}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split("\n")) {
      if (line.trim().length > 0 && stderrLines.length < 20) {
        stderrLines.push(line.trim());
      }
    }
  });
  console.log(`chrome: ${chrome.path} (source: ${chrome.source})`);
  console.log(`flags: ${CHROME_FLAGS.join(" ")}`);

  try {
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", (error) => rejectSpawn(new HarnessError(`cannot start Chrome: ${error.message}`, 3)));
    });
    const page = await waitForDebugPort(debugPort);
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen) => socket.addEventListener("open", resolveOpen, { once: true }));
    const send = cdpClient(socket);
    const pageErrors = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(
          String(message.params?.exceptionDetails?.exception?.description ?? "page exception"),
        );
      }
    });
    await sendChecked(send, "Runtime.enable");
    await sendChecked(send, "Page.enable");
    const browserVersion = await sendChecked(send, "Browser.getVersion");
    return { child, send, pageErrors, browserVersion };
  } catch (error) {
    // The browser was started by this harness, so stopping it is the cleanup of a
    // failed start; a Chrome that never reached the debug port is not left behind.
    child.kill("SIGTERM");
    await waitForExit(child, 5000);
    throw error;
  }
}

async function sendChecked(send, method, params = {}) {
  const response = await send(method, params);
  if (response.error !== undefined) {
    throw new HarnessError(
      `DevTools ${method} failed: ${response.error.message ?? JSON.stringify(response.error)}`,
      3,
    );
  }
  return response;
}

async function evaluate(send, expression, { awaitPromise = false } = {}) {
  const response = await sendChecked(send, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (response.result?.exceptionDetails !== undefined) {
    const text = response.result.exceptionDetails.text ?? "unknown page exception";
    throw new HarnessError(`page evaluation failed: ${text}`, 3);
  }
  return response.result?.result?.value;
}

async function waitForPlayground(send, timeoutMs = PAGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "the playground object never appeared";
  while (Date.now() < deadline) {
    try {
      const present = await evaluate(
        send,
        "typeof globalThis.__enginePlayground === 'object'",
      );
      if (present === true) {
        const raw = await evaluate(
          send,
          "globalThis.__enginePlayground.ready.then((state) => JSON.stringify(state))",
          { awaitPromise: true },
        );
        if (typeof raw === "string") {
          const state = JSON.parse(raw);
          if (state.ok === true) {
            return state;
          }
          lastError = state.error ?? "the engine reported that it did not start";
          break;
        }
        lastError = "the ready hook did not resolve";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  fail(`the playground did not become ready: ${lastError}`, 3);
}

// ---------------------------------------------------------------------------
// Scenes and cameras.
// ---------------------------------------------------------------------------

async function loadTestKit() {
  const modulePath = join(REPO_ROOT, "packages/test-kit/dist/scenes.js");
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    fail(
      `cannot import ${modulePath}: ${error instanceof Error ? error.message : String(error)}; run "pnpm --filter @project-air/test-kit run build" first`,
    );
  }
}

function sceneAnchor(scene) {
  const object = scene.objects.find((candidate) => candidate.id === SAMPLE_ZOOM_ANCHOR_ID);
  if (object === undefined) {
    fail(`the sample scene has no object "${SAMPLE_ZOOM_ANCHOR_ID}" to anchor the zoom cameras`);
  }
  return { worldX: object.x + object.width / 2, worldY: object.y + object.height / 2 };
}

/**
 * Builds the named scene list from the test-kit bundles. The counts and the camera
 * anchor come from the same builders the page loads, so a scene change can never
 * leave the harness comparing a different document.
 */
function sceneDefinitions(testKit) {
  const sample = testKit.buildSampleScene();
  const engineCore = testKit.buildEngineCoreScene();
  const anchor = sceneAnchor(sample);
  const byName = new Map([
    ["sample", sample],
    ["engine-core", engineCore],
    ["layers", testKit.buildLayersScene()],
  ]);
  return SCENE_DEFINITIONS.map((definition) => {
    // A page-owned scene (the P4-10 titles gallery) is not built by the test-kit;
    // it carries its expected counts and world explicitly, so the harness still
    // asserts the document the page reports.
    const pageOwned = definition.expectedCounts !== undefined;
    const scene = pageOwned
      ? null
      : definition.scene === "stress"
        ? testKit.buildStressScene(definition.count)
        : byName.get(definition.scene);
    if (!pageOwned && scene === undefined) {
      fail(`unknown scene "${definition.scene}" in the visual scene list`);
    }
    const view =
      definition.view === null
        ? null
        : {
            // A scene may name its own anchor; the sample board's zone-0001 is the default.
            worldX: definition.view.worldX ?? anchor.worldX,
            worldY: definition.view.worldY ?? anchor.worldY,
            zoom: definition.view.zoom,
          };
    const count = definition.count ?? null;
    const extra = definition.extra ?? {};
    return {
      name: definition.name,
      scene: definition.scene,
      count,
      view,
      fitAction: definition.fitAction === true,
      counts: { ...(definition.expectedCounts ?? scene.metadata.counts) },
      world: { ...(definition.expectedWorld ?? scene.metadata.world) },
      camera: definition.camera,
      url: (baseUrl) => {
        const parameters = new URLSearchParams({ scene: definition.scene });
        if (count !== null) {
          parameters.set("count", String(count));
        }
        if (view !== null) {
          parameters.set("view", `${view.worldX},${view.worldY},${view.zoom}`);
        }
        for (const [key, value] of Object.entries(extra)) {
          parameters.set(key, value);
        }
        return `${baseUrl}?${parameters.toString()}`;
      },
    };
  });
}

function selectScenes(scenes, names) {
  if (names.length === 0) {
    return scenes;
  }
  const selected = [];
  for (const name of names) {
    const scene = scenes.find((candidate) => candidate.name === name);
    if (scene === undefined) {
      fail(
        `unknown --scene "${name}"; expected one of ${scenes.map((candidate) => candidate.name).join(", ")}`,
      );
    }
    if (!selected.includes(scene)) {
      selected.push(scene);
    }
  }
  return selected;
}

function selectViewports(names) {
  if (names.length === 0) {
    return VIEWPORTS;
  }
  const selected = [];
  for (const name of names) {
    const viewport = VIEWPORTS.find((candidate) => candidate.name === name);
    if (viewport === undefined) {
      fail(
        `unknown --viewport "${name}"; expected one of ${VIEWPORTS.map((candidate) => candidate.name).join(", ")}`,
      );
    }
    if (!selected.includes(viewport)) {
      selected.push(viewport);
    }
  }
  return selected;
}

function baselineName(scene, viewport) {
  return `${scene.name}-${viewport.name}-${BACKEND}.png`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function classifyRenderer(renderer) {
  const software = SOFTWARE_RENDERER.test(renderer);
  const identified = !software && REAL_GPU_ANGLE.test(renderer) && REAL_GPU_HINTS.test(renderer);
  return { renderer, software, identified };
}

// ---------------------------------------------------------------------------
// Capture.
// ---------------------------------------------------------------------------

async function captureState({ send, scene, viewport, baseUrl }) {
  await sendChecked(send, "Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  const url = scene.url(baseUrl);
  await sendChecked(send, "Page.navigate", { url });
  const readyState = await waitForPlayground(send);

  let fitAction = null;
  if (scene.fitAction) {
    const raw = await evaluate(send, FIT_ACTION_EXPRESSION, { awaitPromise: true });
    if (typeof raw !== "string") {
      fail(`the fit action of "${scene.name}" at "${viewport.name}" did not report a result`, 3);
    }
    fitAction = JSON.parse(raw);
  }

  await evaluate(send, HIDE_VOLATILE_HUD_EXPRESSION);
  await evaluate(send, "globalThis.__enginePlayground.pause()");
  await evaluate(send, SETTLE_EXPRESSION, { awaitPromise: true });
  await delay(CAPTURE_SETTLE_MS);

  const layoutRaw = await evaluate(send, LAYOUT_EXPRESSION);
  if (typeof layoutRaw !== "string") {
    fail(`could not read the page layout of "${scene.name}" at "${viewport.name}"`, 3);
  }
  const layout = JSON.parse(layoutRaw);
  const screencast = await sendChecked(send, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const screenshotBytes = Buffer.from(String(screencast.result?.data ?? ""), "base64");
  if (screenshotBytes.length === 0) {
    fail(`the DevTools screenshot of "${scene.name}" at "${viewport.name}" was empty`, 3);
  }
  let image;
  try {
    image = decodePng(screenshotBytes);
  } catch (error) {
    fail(
      `the DevTools screenshot of "${scene.name}" at "${viewport.name}" cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
      3,
    );
  }
  const renderer = String(await evaluate(send, RENDERER_EXPRESSION));

  const expectedCamera = expectedCameraState(scene, layout);
  const assertions = {
    screenshotSize:
      image.width === viewport.width && image.height === viewport.height
        ? { passed: true, expected: `${viewport.width}x${viewport.height}`, actual: `${image.width}x${image.height}` }
        : { passed: false, expected: `${viewport.width}x${viewport.height}`, actual: `${image.width}x${image.height}` },
    window: {
      passed: layout.inner.width === viewport.width && layout.inner.height === viewport.height,
      expected: `${viewport.width}x${viewport.height}`,
      actual: `${layout.inner.width}x${layout.inner.height}`,
    },
    devicePixelRatio: {
      passed: layout.devicePixelRatio === 1,
      expected: 1,
      actual: layout.devicePixelRatio,
    },
    scene: {
      passed: layout.state.scene === scene.scene,
      expected: scene.scene,
      actual: layout.state.scene,
    },
    objectCount: {
      passed: layout.state.objectCount === scene.counts.total,
      expected: scene.counts.total,
      actual: layout.state.objectCount,
    },
    counts: {
      passed:
        layout.state.counts.cards === scene.counts.cards &&
        layout.state.counts.zones === scene.counts.zones &&
        layout.state.counts.blocks === scene.counts.blocks,
      expected: {
        cards: scene.counts.cards,
        zones: scene.counts.zones,
        blocks: scene.counts.blocks,
      },
      actual: layout.state.counts,
    },
    camera:
      expectedCamera === null
        ? { passed: true, expected: "playground initial camera", actual: layout.state.camera }
        : expectedCamera,
    fitAction: {
      passed:
        !scene.fitAction ||
        (fitAction !== null && fitAction.framesAfter > fitAction.framesBefore),
      expected: scene.fitAction
        ? "the L19 fit action renders at least one frame"
        : "no fit action in this scene",
      actual: fitAction,
    },
    pageError: {
      passed: layout.error === "",
      expected: "",
      actual: layout.error,
    },
  };

  return {
    scene: scene.name,
    sceneId: scene.scene,
    viewport: viewport.name,
    viewportSize: `${viewport.width}x${viewport.height}`,
    backend: BACKEND,
    backendLabel: BACKEND_LABEL,
    url,
    fitAction,
    ready: {
      scene: readyState.scene,
      objectCount: readyState.objectCount,
      visibleCount: readyState.visibleCount,
    },
    renderer,
    layout,
    image,
    assertions,
  };
}

function expectedCameraState(scene, layout) {
  if (scene.fitAction) {
    // Mirrors Camera::fitBounds for a world that starts at (0, 0): zoom into the
    // viewport below the L02 top padding, at most 100 %, then centre the content.
    const cssWidth = layout.canvas?.cssWidth ?? 0;
    const cssHeight = layout.canvas?.cssHeight ?? 0;
    const availableHeight = Math.max(cssHeight - FIT_TOP_PADDING, 0);
    const zoom = Math.min(
      Math.max(
        Math.min(cssWidth / scene.world.width, availableHeight / scene.world.height, MAX_FIT_ZOOM),
        MINIMUM_ZOOM,
      ),
      MAXIMUM_ZOOM,
    );
    const contentScreenLeft = (cssWidth - scene.world.width * zoom) / 2;
    const contentScreenTop =
      FIT_TOP_PADDING + (availableHeight - scene.world.height * zoom) / 2;
    const expectedPanX = -contentScreenLeft / zoom;
    const expectedPanY = -contentScreenTop / zoom;
    const camera = layout.state.camera;
    const passed =
      Math.abs(camera.zoom - zoom) <= 1e-6 &&
      Math.abs(camera.panX - expectedPanX) <= 1e-6 &&
      Math.abs(camera.panY - expectedPanY) <= 1e-6;
    return {
      passed,
      expected: { zoom, panX: expectedPanX, panY: expectedPanY },
      actual: camera,
      source: `L19 fit of the ${scene.world.width}x${scene.world.height} world below the ${FIT_TOP_PADDING} px top padding, at most 100 %`,
    };
  }
  if (scene.view === null) {
    return null;
  }
  const zoom = Math.min(Math.max(scene.view.zoom, MINIMUM_ZOOM), MAXIMUM_ZOOM);
  const cssWidth = layout.canvas?.cssWidth ?? 0;
  const cssHeight = layout.canvas?.cssHeight ?? 0;
  const expectedPanX = scene.view.worldX - cssWidth / zoom / 2;
  const expectedPanY = scene.view.worldY - cssHeight / zoom / 2;
  const camera = layout.state.camera;
  const passed =
    Math.abs(camera.zoom - zoom) <= 1e-6 &&
    Math.abs(camera.panX - expectedPanX) <= 1e-6 &&
    Math.abs(camera.panY - expectedPanY) <= 1e-6;
  return {
    passed,
    expected: { zoom, panX: expectedPanX, panY: expectedPanY },
    actual: camera,
    source: `?view=${scene.view.worldX},${scene.view.worldY},${scene.view.zoom}`,
  };
}

function assertionFailures(capture) {
  const failures = [];
  for (const [name, assertion] of Object.entries(capture.assertions)) {
    if (assertion && assertion.passed === false) {
      failures.push({
        assertion: name,
        expected: assertion.expected,
        actual: assertion.actual,
      });
    }
  }
  return failures;
}

// Log context for one capture: the exact capture URL and the effective camera.
// The deterministic `?view` state is part of the evidence contract, so the gate
// log alone documents which camera produced which reference comparison.
function captureLogContext(capture) {
  const camera = capture.layout?.state?.camera ?? {};
  const zoom = typeof camera.zoom === "number" ? camera.zoom : 0;
  const panX = typeof camera.panX === "number" ? camera.panX : 0;
  const panY = typeof camera.panY === "number" ? camera.panY : 0;
  return `url=${capture.url} camera=(panX ${panX.toFixed(3)}, panY ${panY.toFixed(3)}, zoom ${zoom.toFixed(4)})`;
}

// ---------------------------------------------------------------------------
// Evidence helpers.
// ---------------------------------------------------------------------------

function timestampSlug(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function hardwareInfo() {
  const cpuList = cpus();
  return {
    model: cpuList[0]?.model ?? "unknown",
    logicalCores: cpuList.length,
    memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    arch: process.arch,
    os: { type: osType(), release: osRelease(), version: osVersion() },
    node: process.version,
  };
}

function fileSize(relative) {
  const path = join(REPO_ROOT, relative);
  return existsSync(path) ? readFileSync(path).length : 0;
}

function buildInfo() {
  const wasmBytes = readFileSync(join(REPO_ROOT, "packages/engine/build-wasm/engine.wasm"));
  return {
    profile: "Release",
    wasmRawBytes: wasmBytes.length,
    wasmGzipBytes: deflateSync(wasmBytes, { level: 9 }).length,
    engineJsBytes: fileSize("packages/engine/build-wasm/engine.js"),
    bridgeBytes: fileSize("packages/engine/dist/bridge/engine.js"),
    testKitBytes: fileSize("packages/test-kit/dist/scenes.js"),
  };
}

function commandLine(options) {
  const parts = [HARNESS_RELATIVE];
  if (options.update) {
    parts.push("--update");
  }
  if (options.task !== null) {
    parts.push("--task", options.task);
  }
  for (const scene of options.scenes) {
    parts.push("--scene", scene);
  }
  for (const viewport of options.viewports) {
    parts.push("--viewport", viewport);
  }
  return `node ${parts.join(" ")}`;
}

function parseArgs(argv) {
  const options = { update: false, scenes: [], viewports: [], task: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--update") {
      options.update = true;
    } else if (argument === "--task") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--") || !/^[A-Za-z0-9_.-]+$/.test(value)) {
        fail(`${argument} needs a task id such as P4-04`);
      }
      index += 1;
      options.task = value;
    } else if (argument.startsWith("--task=")) {
      const value = argument.slice("--task=".length);
      if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
        fail("--task needs a task id such as P4-04");
      }
      options.task = value;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--scene" || argument === "--viewport") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(`${argument} needs a value`);
      }
      index += 1;
      if (argument === "--scene") {
        options.scenes.push(value);
      } else {
        options.viewports.push(value);
      }
    } else if (argument.startsWith("--scene=")) {
      options.scenes.push(argument.slice("--scene=".length));
    } else if (argument.startsWith("--viewport=")) {
      options.viewports.push(argument.slice("--viewport=".length));
    } else {
      fail(`unknown argument "${argument}"; see --help`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    `  node ${HARNESS_RELATIVE}                     run the visual gate`,
    `  node ${HARNESS_RELATIVE} --update            write the reference images (review action, not a gate pass)`,
    `  node ${HARNESS_RELATIVE} --scene <name> --viewport <name>`,
    `  node ${HARNESS_RELATIVE} --task <task-id>   name the capture record after the running task`,
    "",
    `  --scene:    ${SCENE_DEFINITIONS.map((scene) => scene.name).join(", ")}`,
    `  --viewport: ${VIEWPORTS.map((viewport) => viewport.name).join(", ")}`,
    "  --task:     task id for the capture record prefix (default P4-04)",
    "",
    "  Exit codes: 0 pass (or baselines written), 1 difference/assertion, 2 usage/build, 3 infra.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

async function run(options) {
  const startedAt = new Date();
  const slug = timestampSlug(startedAt);
  const command = commandLine(options);
  ensureArtefacts();
  const port = readSlotPort("playground");
  const testKit = await loadTestKit();
  const allScenes = sceneDefinitions(testKit);
  const scenes = selectScenes(allScenes, options.scenes);
  const viewports = selectViewports(options.viewports);
  const partial = scenes.length !== allScenes.length || viewports.length !== VIEWPORTS.length;

  const stderrLines = [];
  const captures = [];
  const failures = [];
  const updates = [];
  const missingBaselines = [];
  let pageErrors = [];
  const report = {
    task: evidenceTask,
    gate: GATE,
    mode: options.update ? "update" : "gate",
    command,
    timestamp: startedAt.toISOString(),
    partial,
    backend: BACKEND,
    backendLabel: BACKEND_LABEL,
    tolerance: {
      maxDifferingPixels: MAX_DIFFERING_PIXELS,
      maxDifferingPixelRatio: MAX_DIFFERING_PIXEL_RATIO,
      maxChannelDelta: MAX_CHANNEL_DELTA,
      policy:
        "default exact match (0 differing pixels); an antialiasing allowance must be documented in docs/gates/visual-diff.md and approved in review",
    },
    viewports: viewports.map(({ name, width, height }) => ({ name, width, height, devicePixelRatio: 1 })),
    scenes: scenes.map((scene) => ({
      name: scene.name,
      scene: scene.scene,
      count: scene.count,
      camera: scene.camera,
      fitAction: scene.fitAction,
      view:
        scene.view === null
          ? null
          : { worldX: scene.view.worldX, worldY: scene.view.worldY, zoom: scene.view.zoom },
      expectedCounts: scene.counts,
      world: scene.world,
    })),
    baselineDirectory: "reviews/evidence/visual-baselines",
    hardware: hardwareInfo(),
    build: buildInfo(),
    browser: null,
    gpu: null,
    port,
    captures,
    failures,
    updates,
    missingBaselines,
    pageErrors,
    chromeStderr: stderrLines,
  };

  let server = null;
  let child = null;
  let result = "pass";
  let resultReason = "pass";
  let exitCode = 0;

  console.log(`command: ${command}`);
  console.log(`started: ${startedAt.toISOString()}`);
  console.log(
    `scenes: ${scenes.map((scene) => scene.name).join(", ")}; viewports: ${viewports.map((viewport) => viewport.name).join(", ")}; backend: ${BACKEND_LABEL}`,
  );
  if (partial) {
    console.log("mode: partial run (--scene/--viewport filter); the gate runs the full set");
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "p404-visual-"));
  try {
    copyArtefacts(tempRoot);
    const baseUrl = `http://127.0.0.1:${port}/apps/engine-playground/`;
    console.log(`serve ${tempRoot} on ${baseUrl}`);
    server = await startStaticServer(tempRoot, port);
    const chrome = findChrome();
    const session = await launchChrome({ chrome, tempRoot, stderrLines });
    child = session.child;
    const { send } = session;
    // `Runtime.exceptionThrown` events collected by the DevTools client are the
    // page exceptions the run reports; the same array is printed in the record.
    pageErrors = session.pageErrors;
    report.browser = {
      product: session.browserVersion.result?.product ?? "unknown",
      revision: session.browserVersion.result?.revision ?? "unknown",
      executable: chrome.path,
      source: chrome.source,
      flags: CHROME_FLAGS,
    };

    let rendererChecked = false;
    captureLoop: for (const scene of scenes) {
      for (const viewport of viewports) {
        let capture;
        try {
          capture = await captureState({ send, scene, viewport, baseUrl });
        } catch (error) {
          if (error instanceof HarnessError && error.exitCode === 3) {
            result = "infra";
            resultReason = error.message;
            break captureLoop;
          }
          throw error;
        }

        const captureRecord = {
          scene: capture.scene,
          sceneId: capture.sceneId,
          viewport: capture.viewport,
          viewportSize: capture.viewportSize,
          backend: capture.backend,
          backendLabel: capture.backendLabel,
          url: capture.url,
          fitAction: capture.fitAction,
          ready: capture.ready,
          renderer: capture.renderer,
          capturedWidth: capture.image.width,
          capturedHeight: capture.image.height,
          layout: capture.layout,
          assertions: capture.assertions,
          baseline: null,
          comparison: null,
          diffPng: null,
          baselineName: baselineName(scene, viewport),
        };
        captures.push(captureRecord);

        if (!rendererChecked) {
          rendererChecked = true;
          report.gpu = {
            ...classifyRenderer(capture.renderer),
            policy:
              "fail-closed: renderer must match ANGLE (...) plus a known GPU hint and must not be software",
          };
          if (!report.gpu.identified) {
            result = "infra";
            resultReason = report.gpu.software
              ? `software WebGL renderer "${capture.renderer}" is not a valid visual pass`
              : `renderer "${capture.renderer}" is not positively identified as a real GPU (fail-closed)`;
            break captureLoop;
          }
        }

        const captureAssertionFailures = assertionFailures(capture);
        if (captureAssertionFailures.length > 0) {
          result = "fail";
          for (const failure of captureAssertionFailures) {
            failures.push({
              scene: scene.name,
              viewport: viewport.name,
              backend: BACKEND,
              kind: "assertion",
              ...failure,
            });
          }
          resultReason = `${failures.length} capture assertion(s) failed`;
          continue;
        }

        const baselineRelative = join("reviews", "evidence", "visual-baselines", captureRecord.baselineName);
        if (options.update) {
          const baselineBytes = encodePng({
            width: capture.image.width,
            height: capture.image.height,
            rgba: capture.image.rgba,
          });
          mkdirSync(BASELINE_DIR, { recursive: true });
          const absolute = join(REPO_ROOT, baselineRelative);
          writeFileSync(absolute, baselineBytes);
          captureRecord.baseline = {
            path: baselineRelative,
            written: true,
            sha256: sha256(baselineBytes),
            bytes: baselineBytes.length,
          };
          updates.push({
            scene: scene.name,
            viewport: viewport.name,
            backend: BACKEND,
            baseline: baselineRelative,
          });
          console.log(`baseline written: ${baselineRelative}; ${captureLogContext(captureRecord)}`);
          continue;
        }

        const baselineAbsolute = join(REPO_ROOT, baselineRelative);
        if (!existsSync(baselineAbsolute)) {
          missingBaselines.push({ scene: scene.name, viewport: viewport.name, baseline: baselineRelative });
          throw new HarnessError(
            `missing baseline ${baselineRelative} for scene "${scene.name}" at viewport "${viewport.name}" (backend ${BACKEND_LABEL}); run "node ${HARNESS_RELATIVE} --update" to write the first reviewed baseline set`,
            2,
          );
        }
        let baselineImage;
        const baselineBytes = readFileSync(baselineAbsolute);
        try {
          baselineImage = decodePng(baselineBytes);
        } catch (error) {
          throw new HarnessError(
            `baseline ${baselineRelative} cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
            2,
          );
        }
        const comparison = compareImages(baselineImage, capture.image);
        captureRecord.baseline = {
          path: baselineRelative,
          written: false,
          sha256: sha256(baselineBytes),
          bytes: baselineBytes.length,
        };
        captureRecord.comparison = comparison;
        if (!comparison.withinTolerance) {
          const diffRelativeName = `${evidenceTask}-visual-${slug}-${scene.name}-${viewport.name}-${BACKEND}.diff.png`;
          const diffAbsolute = writeDiffPng(capture.image, baselineImage, diffRelativeName);
          captureRecord.diffPng = diffAbsolute.slice(REPO_ROOT.length);
          result = "fail";
          resultReason = `${failures.length + 1} reference image(s) differ`;
          failures.push({
            scene: scene.name,
            viewport: viewport.name,
            backend: BACKEND,
            kind: "difference",
            baseline: baselineRelative,
            diffPng: captureRecord.diffPng,
            capturedWidth: capture.image.width,
            capturedHeight: capture.image.height,
            differingPixels: comparison.differingPixels,
            differingPixelRatio: comparison.differingPixelRatio,
            worstChannelDelta: comparison.worstChannelDelta,
            dimensionMismatch: comparison.dimensionMismatch,
          });
          console.log(
            `FAIL ${scene.name} ${viewport.name} ${BACKEND_LABEL}: ${comparison.differingPixels} differing pixel(s), worst channel delta ${comparison.worstChannelDelta} vs ${baselineRelative}; diff ${captureRecord.diffPng}; ${captureLogContext(captureRecord)}`,
          );
          continue;
        }
        console.log(
          `pass ${scene.name} ${viewport.name} ${BACKEND_LABEL}: ${comparison.differingPixels} differing pixel(s), worst channel delta ${comparison.worstChannelDelta} vs ${baselineRelative}; ${captureLogContext(captureRecord)}`,
        );
      }
    }

    if (result === "pass" && options.update) {
      result = "update";
      resultReason = `reference images written for review (${updates.length}); an update is an explicit review action and never a gate pass`;
    }
    if (pageErrors.length > 0 && (result === "pass" || result === "update")) {
      result = "fail";
      resultReason = `page exception: ${pageErrors[0]}`;
      failures.push({ kind: "page-exception", message: pageErrors[0] });
    }
  } catch (error) {
    if (error instanceof HarnessError) {
      if (error.exitCode === 3) {
        result = "infra";
      } else {
        result = "fail";
      }
      resultReason = error.message;
      // A usage/build problem (for example a missing baseline) keeps its own exit
      // code so it is never mistaken for the pixel-difference failure of A2.
      if (error.exitCode === 2) {
        exitCode = 2;
      }
    } else {
      throw error;
    }
  } finally {
    if (server !== null) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    if (child !== null) {
      try {
        await sendCloseChild(child);
      } finally {
        child = null;
      }
    }
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - startedAt.getTime();
  report.result = result;
  report.resultReason = resultReason;
  report.pageErrors = pageErrors;
  report.captures = captures;
  report.failures = failures;
  report.updates = updates;
  report.missingBaselines = missingBaselines;

  if (result === "infra") {
    exitCode = 3;
  } else if (result === "fail") {
    exitCode = exitCode === 2 ? 2 : 1;
  } else {
    exitCode = 0;
  }
  report.exitCode = exitCode;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const reportRelative = join("reviews", "evidence", `${evidenceTask}-visual-run-${slug}.json`);
  writeFileSync(
    join(REPO_ROOT, reportRelative),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (report.gpu !== null) {
    console.log(
      `renderer: ${report.gpu.renderer} (identified: ${report.gpu.identified}, software: ${report.gpu.software})`,
    );
  }
  if (report.browser !== null) {
    console.log(
      `browser: ${report.browser.product} (revision ${report.browser.revision}); executable ${report.browser.executable}`,
    );
  }
  console.log(`captures: ${captures.length}`);
  console.log(`evidence: ${reportRelative}`);
  if (result === "update") {
    console.log(`result: update — ${resultReason}`);
  } else {
    console.log(`result: ${result}${result === "pass" ? "" : ` — ${resultReason}`}`);
  }
  process.exitCode = exitCode;
}

async function sendCloseChild(child) {
  // Browser.close was not necessarily reachable (the socket may be gone); a
  // SIGTERM to the browser this harness started is the safe fallback.
  child.kill("SIGTERM");
  await waitForExit(child, 5000);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HarnessError) {
      console.error(`${GATE}: ${error.message}`);
      console.error(usage());
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.task !== null) {
    evidenceTask = options.task;
  }
  const filters = assertPngCodec();
  console.log(`png self-test: OK (decode/encode round trip, scanline filters 0-4, ${filters} filter sets)`);
  await run(options);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${GATE}: ${message}`);
  process.exitCode = error instanceof HarnessError ? error.exitCode : 2;
}
