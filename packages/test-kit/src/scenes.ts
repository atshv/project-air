// Deterministic board scenes for the engine playground and the engine gates.
//
// A scene is a plain array of engine rectangles plus metadata. The fields
// `x`, `y`, `width`, `height`, `tone` and `layer` are exactly what
// `createEngine(canvas).loadRectangles()` reads; `id`, `kind` and `parent` are
// metadata for tests, harnesses and the HUD. Scenes are pure functions of their
// arguments: one seeded PRNG, integer geometry on the 16 px canvas grid, no
// ambient randomness, no clock and no locale-dependent formatting, so every
// machine builds identical objects, ids and world bounds.
//
// This package may import `packages/contracts` only (docs/module-map.md), so
// the engine's tone/layer names and camera zoom clamp are mirrored here instead
// of imported from `@project-air/engine`; the bridge validates them
// structurally. `docs/engine.md` records the scene contract.

/** Scene names accepted by the playground's `?scene=` query. */
export type SceneName = "sample" | "stress" | "engine-core";

/** Engine tone names; `neutral` is the card surface, `tone-a` … `tone-e` are the zone tones. */
export type SceneTone = "neutral" | "tone-a" | "tone-b" | "tone-c" | "tone-d" | "tone-e";

/** Engine design layers (design rule §8): zones below blocks below note cards. */
export type SceneLayer = "zones" | "blocks" | "note-cards";

/** What a scene object represents on the board (metadata only, the engine draws a rectangle). */
export type SceneObjectKind = "zone" | "block" | "card";

/** One scene object: an engine rectangle with a short stable id and board metadata. */
export interface SceneObject {
  /** Short stable id: `card-0001`, `zone-0001`, `block-0001` or `stress-00001`. */
  readonly id: string;
  readonly kind: SceneObjectKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tone: SceneTone;
  readonly layer: SceneLayer;
  /** Containing zone id for blocks and cards that sit in a zone; null for zones and free cards. */
  readonly parent: string | null;
}

/** World size in contract pixels. */
export interface SceneWorld {
  readonly width: number;
  readonly height: number;
}

/** Bounds of all objects in world space. */
export interface SceneBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Objects per kind; `total` is the document size. */
export interface SceneCounts {
  readonly zones: number;
  readonly blocks: number;
  readonly cards: number;
  readonly total: number;
}

/**
 * Fit of the world into a viewport: `zoom` is clamped to the engine camera range,
 * `clamped` is true when the raw fit zoom fell below the minimum.
 */
export interface SceneFit {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly clamped: boolean;
}

/** Everything a harness needs to reproduce a scene besides the rectangles. */
export interface SceneMetadata {
  readonly name: SceneName;
  readonly seed: number;
  readonly world: SceneWorld;
  readonly counts: SceneCounts;
  readonly bounds: SceneBounds;
  /** Fit at the reference viewports: desktop 1440x900, mobile 390x844. */
  readonly fit: { readonly desktop: SceneFit; readonly mobile: SceneFit };
  /** Zoom clamp of the engine camera, mirrored for the playground. */
  readonly camera: { readonly minimumZoom: number; readonly maximumZoom: number };
}

/** A deterministic board scene: engine rectangles plus reproduction metadata. */
export interface Scene {
  readonly objects: readonly SceneObject[];
  readonly metadata: SceneMetadata;
}

/** Sample board: exactly 500 note cards and 50 zones with contained blocks. */
export const SAMPLE_CARD_COUNT = 500;
export const SAMPLE_ZONE_COUNT = 50;
/**
 * Engine-core interactive board: exactly 10,000 mixed board objects (9,200
 * cards, 200 zones and 600 blocks). This is the L01/D10 target document for the
 * `perf` gate, not a rectangle grid.
 */
export const ENGINE_CORE_CARD_COUNT = 9200;
export const ENGINE_CORE_ZONE_COUNT = 200;
export const ENGINE_CORE_BLOCK_COUNT = 600;
export const ENGINE_CORE_OBJECT_COUNT =
  ENGINE_CORE_CARD_COUNT + ENGINE_CORE_ZONE_COUNT + ENGINE_CORE_BLOCK_COUNT;
/**
 * Engine-core world in contract pixels, multiples of the 16 px canvas grid. The
 * sample board's zone sizes repeat on a 20 x 10 zone grid; the fit zoom at
 * 1440x900 clamps to the engine's 0.1 minimum, so the interactive camera path
 * starts at the clamp and zooms in from there.
 */
export const ENGINE_CORE_WORLD: SceneWorld = { width: 19200, height: 10816 };

/** Stress scene: default object count and the maximum document size of the engine. */
export const STRESS_DEFAULT_OBJECT_COUNT = 10000;
export const MAX_SCENE_OBJECT_COUNT = 50000;
/**
 * Sample world in contract pixels, close to the 16:9 playground canvas; both
 * dimensions are multiples of the 16 px canvas grid so every sample coordinate
 * stays on the grid.
 */
export const SAMPLE_WORLD: SceneWorld = { width: 9600, height: 5408 };

const SAMPLE_SEED = 20261025;
const STRESS_SEED = 20261026;
const ENGINE_CORE_SEED = 20261027;

// Mirrors of engine values, not design values: `tokens::canvas_grid` and the
// provisional camera clamp in docs/engine.md.
const CANVAS_GRID = 16;
const MINIMUM_ZOOM = 0.1;
const MAXIMUM_ZOOM = 8;

const TONE_NAMES: readonly SceneTone[] = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
const STRESS_LAYERS: readonly SceneLayer[] = ["note-cards", "zones", "blocks"];

const ZONE_COLUMNS = 10;
const ZONE_ROWS = 5;
const ZONE_PADDING = 32;
const BLOCK_BAND_HEIGHT = 96;
const CARDS_PER_ZONE = 8;
const CARD_COLUMNS = 2;
const CARD_ROWS = 4;
const CARD_GAP = 16;
const CARDS_TOP_OFFSET = 160;
const EDGE_CORNER_CARDS = 4;
const OUTSIDE_COLUMNS = 20;
const OUTSIDE_ROWS = 12;
const CARD_PADDING = 32;
const SNAP_MARGIN = 16;

// Engine-core board layout: the sample board's zone pattern on a 20 x 10 grid.
// Every zone gets exactly three blocks and eight contained cards, which fixes
// the document at 200 zones + 600 blocks + 9,200 cards = 10,000 objects.
const ENGINE_CORE_ZONE_COLUMNS = 20;
const ENGINE_CORE_ZONE_ROWS = 10;
const ENGINE_CORE_BLOCKS_PER_ZONE = 3;
const ENGINE_CORE_CARDS_PER_ZONE = 8;

/**
 * Mulberry32 seeded PRNG: 32-bit integer arithmetic only, so the sequence is
 * identical on every machine and Node.js version.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the sample board: 500 cards, 50 zones with contained blocks, tone variety. */
export function buildSampleScene(): Scene {
  const random = createSeededRandom(SAMPLE_SEED);
  const zones: SceneObject[] = [];
  const blocks: SceneObject[] = [];
  const cards: SceneObject[] = [];

  const toneOffset = randomInteger(random, 0, TONE_NAMES.length - 1);
  for (let index = 0; index < SAMPLE_ZONE_COUNT; index += 1) {
    const column = index % ZONE_COLUMNS;
    const row = Math.floor(index / ZONE_COLUMNS);
    // Wide size and position ranges plus deliberate overlaps keep the board
    // organic instead of a stamp grid of equal cells.
    const width = snapToGrid(480 + random() * 340);
    const height = snapToGrid(560 + random() * 420);
    const rawX = snapToGrid(
      column * (SAMPLE_WORLD.width / ZONE_COLUMNS) + 32 + random() * 320,
    );
    const rawY = snapToGrid(row * (SAMPLE_WORLD.height / ZONE_ROWS) + 32 + random() * 300);
    zones.push({
      id: idOf("zone", index),
      kind: "zone",
      x: clamp(rawX, 0, SAMPLE_WORLD.width - 32 - width),
      y: clamp(rawY, 0, SAMPLE_WORLD.height - 32 - height),
      width,
      height,
      tone: toneAt(index + toneOffset),
      layer: "zones",
      parent: null,
    });
  }

  // 2-4 blocks per zone in the zone's top band, above the card slots: the layer
  // order zone < block < card is visible in every zone.
  let blockIndex = 0;
  for (const zone of zones) {
    const blockCount = 2 + randomInteger(random, 0, 2);
    for (let index = 0; index < blockCount; index += 1) {
      const width = snapToGrid(56 + random() * 80);
      const height = snapToGrid(48 + random() * 40);
      const rawX = snapToGrid(
        zone.x + ZONE_PADDING + random() * Math.max(0, zone.width - 2 * ZONE_PADDING - width),
      );
      const rawY = snapToGrid(
        zone.y + ZONE_PADDING + random() * Math.max(0, BLOCK_BAND_HEIGHT - height),
      );
      blocks.push({
        id: idOf("block", blockIndex),
        kind: "block",
        x: clamp(rawX, zone.x + ZONE_PADDING, zone.x + zone.width - ZONE_PADDING - width),
        y: clamp(rawY, zone.y + ZONE_PADDING, zone.y + ZONE_PADDING + BLOCK_BAND_HEIGHT - height),
        width,
        height,
        tone: "neutral",
        layer: "blocks",
        parent: zone.id,
      });
      blockIndex += 1;
    }
  }

  // Four cards pinned near the world corners prove the scene reaches the edges.
  for (let index = 0; index < EDGE_CORNER_CARDS; index += 1) {
    const width = snapToGrid(160 + random() * 128);
    const height = snapToGrid(80 + random() * 112);
    cards.push({
      id: idOf("card", cards.length),
      kind: "card",
      x: index % 2 === 0 ? 48 : SAMPLE_WORLD.width - 48 - width,
      y: index < 2 ? 48 : SAMPLE_WORLD.height - 48 - height,
      width,
      height,
      tone: "neutral",
      layer: "note-cards",
      parent: null,
    });
  }

  // Eight cards per zone in a jittered 2 x 4 slot grid below the block band; the
  // jitter keeps the board irregular and every seventeenth card deliberately
  // straddles the zone's right edge so the card-over-zone layer order is visible.
  for (const zone of zones) {
    const slotWidth = (zone.width - 2 * CARD_PADDING - (CARD_COLUMNS - 1) * CARD_GAP) / CARD_COLUMNS;
    const cardsHeight = zone.height - CARDS_TOP_OFFSET - CARD_PADDING;
    const slotHeight = (cardsHeight - (CARD_ROWS - 1) * CARD_GAP) / CARD_ROWS;
    const maximumHeight = Math.floor(slotHeight / CANVAS_GRID) * CANVAS_GRID;
    const maximumWidth = Math.floor(slotWidth / CANVAS_GRID) * CANVAS_GRID;
    for (let index = 0; index < CARDS_PER_ZONE; index += 1) {
      const column = index % CARD_COLUMNS;
      const row = Math.floor(index / CARD_COLUMNS);
      const width = Math.min(snapToGrid(112 + random() * 96), maximumWidth);
      const height = Math.min(snapToGrid(64 + random() * 64), maximumHeight);
      const slotX =
        zone.x +
        CARD_PADDING +
        column * (slotWidth + CARD_GAP) +
        random() * Math.max(0, slotWidth - width);
      const slotY =
        zone.y +
        CARDS_TOP_OFFSET +
        row * (slotHeight + CARD_GAP) +
        random() * Math.max(0, slotHeight - height);
      const straddlesZoneEdge = cards.length % 17 === 0;
      const rawX = straddlesZoneEdge
        ? snapToGrid(zone.x + zone.width - width / 2)
        : snapToGrid(slotX);
      const rawY = snapToGrid(slotY);
      cards.push({
        id: idOf("card", cards.length),
        kind: "card",
        x: clamp(rawX, SNAP_MARGIN, SAMPLE_WORLD.width - SNAP_MARGIN - width),
        y: clamp(rawY, zone.y + CARDS_TOP_OFFSET, zone.y + zone.height - CARD_PADDING - height),
        width,
        height,
        tone: "neutral",
        layer: "note-cards",
        parent: zone.id,
      });
    }
  }

  // Remaining cards are free cards on a jittered cell grid across the world:
  // deterministic selection from more cells than cards keeps the board irregular.
  const freeCardCount = SAMPLE_CARD_COUNT - cards.length;
  const cellWidth = SAMPLE_WORLD.width / OUTSIDE_COLUMNS;
  const cellHeight = SAMPLE_WORLD.height / OUTSIDE_ROWS;
  const cells = shuffledCellIndices(random, OUTSIDE_COLUMNS * OUTSIDE_ROWS)
    .slice(0, freeCardCount)
    .sort((left, right) => left - right);
  for (const cell of cells) {
    const column = cell % OUTSIDE_COLUMNS;
    const row = Math.floor(cell / OUTSIDE_COLUMNS);
    const width = snapToGrid(160 + random() * 128);
    const height = snapToGrid(80 + random() * 112);
    const rawX = snapToGrid(column * cellWidth + 16 + random() * Math.max(0, cellWidth - 32 - width));
    const rawY = snapToGrid(row * cellHeight + 16 + random() * Math.max(0, cellHeight - 32 - height));
    cards.push({
      id: idOf("card", cards.length),
      kind: "card",
      x: clamp(rawX, SNAP_MARGIN, SAMPLE_WORLD.width - SNAP_MARGIN - width),
      y: clamp(rawY, SNAP_MARGIN, SAMPLE_WORLD.height - SNAP_MARGIN - height),
      width,
      height,
      tone: "neutral",
      layer: "note-cards",
      parent: null,
    });
  }

  const objects: readonly SceneObject[] = [...zones, ...blocks, ...cards];
  return {
    objects,
    metadata: {
      name: "sample",
      seed: SAMPLE_SEED,
      world: SAMPLE_WORLD,
      counts: countObjects(objects),
      bounds: boundsOf(objects),
      fit: { desktop: fitViewport(SAMPLE_WORLD, 1440, 900), mobile: fitViewport(SAMPLE_WORLD, 390, 844) },
      camera: { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM },
    },
  };
}

/**
 * Builds the engine-core interactive board: exactly 10,000 objects (9,200 note
 * cards, 200 zones with three contained blocks each = 600 blocks) on an organic
 * board, not a rectangle grid. Zones repeat the sample board's jittered sizes and
 * positions on a 20 x 10 zone grid; every zone carries three blocks and eight
 * cards, the remaining cards are free cards spread over the world. Used by the
 * `perf` gate (`--scenario engine-core`) for the 10,000-object pan/zoom target.
 */
export function buildEngineCoreScene(): Scene {
  const random = createSeededRandom(ENGINE_CORE_SEED);
  const zones: SceneObject[] = [];
  const blocks: SceneObject[] = [];
  const cards: SceneObject[] = [];

  const zoneColumns = ENGINE_CORE_ZONE_COLUMNS;
  const cellWidth = ENGINE_CORE_WORLD.width / zoneColumns;
  const cellHeight = ENGINE_CORE_WORLD.height / ENGINE_CORE_ZONE_ROWS;
  const toneOffset = randomInteger(random, 0, TONE_NAMES.length - 1);
  for (let index = 0; index < ENGINE_CORE_ZONE_COUNT; index += 1) {
    const column = index % zoneColumns;
    const row = Math.floor(index / zoneColumns);
    const width = snapToGrid(480 + random() * 340);
    const height = snapToGrid(560 + random() * 420);
    const rawX = snapToGrid(column * cellWidth + 32 + random() * 320);
    const rawY = snapToGrid(row * cellHeight + 32 + random() * 300);
    zones.push({
      id: idOf("zone", index),
      kind: "zone",
      x: clamp(rawX, 0, ENGINE_CORE_WORLD.width - 32 - width),
      y: clamp(rawY, 0, ENGINE_CORE_WORLD.height - 32 - height),
      width,
      height,
      tone: toneAt(index + toneOffset),
      layer: "zones",
      parent: null,
    });
  }

  // Exactly three blocks per zone in the zone's top band, above the card slots.
  let blockIndex = 0;
  for (const zone of zones) {
    for (let index = 0; index < ENGINE_CORE_BLOCKS_PER_ZONE; index += 1) {
      const width = snapToGrid(56 + random() * 80);
      const height = snapToGrid(48 + random() * 40);
      const rawX = snapToGrid(
        zone.x + ZONE_PADDING + random() * Math.max(0, zone.width - 2 * ZONE_PADDING - width),
      );
      const rawY = snapToGrid(
        zone.y + ZONE_PADDING + random() * Math.max(0, BLOCK_BAND_HEIGHT - height),
      );
      blocks.push({
        id: idOf("block", blockIndex),
        kind: "block",
        x: clamp(rawX, zone.x + ZONE_PADDING, zone.x + zone.width - ZONE_PADDING - width),
        y: clamp(rawY, zone.y + ZONE_PADDING, zone.y + ZONE_PADDING + BLOCK_BAND_HEIGHT - height),
        width,
        height,
        tone: "neutral",
        layer: "blocks",
        parent: zone.id,
      });
      blockIndex += 1;
    }
  }

  // Eight cards per zone in the sample board's jittered 2 x 4 slot grid; every
  // seventeenth card straddles the zone edge so the card-over-zone order shows.
  for (const zone of zones) {
    const slotWidth = (zone.width - 2 * CARD_PADDING - (CARD_COLUMNS - 1) * CARD_GAP) / CARD_COLUMNS;
    const cardsHeight = zone.height - CARDS_TOP_OFFSET - CARD_PADDING;
    const slotHeight = (cardsHeight - (CARD_ROWS - 1) * CARD_GAP) / CARD_ROWS;
    const maximumHeight = Math.floor(slotHeight / CANVAS_GRID) * CANVAS_GRID;
    const maximumWidth = Math.floor(slotWidth / CANVAS_GRID) * CANVAS_GRID;
    for (let index = 0; index < ENGINE_CORE_CARDS_PER_ZONE; index += 1) {
      const column = index % CARD_COLUMNS;
      const row = Math.floor(index / CARD_COLUMNS);
      const width = Math.min(snapToGrid(112 + random() * 96), maximumWidth);
      const height = Math.min(snapToGrid(64 + random() * 64), maximumHeight);
      const slotX =
        zone.x +
        CARD_PADDING +
        column * (slotWidth + CARD_GAP) +
        random() * Math.max(0, slotWidth - width);
      const slotY =
        zone.y +
        CARDS_TOP_OFFSET +
        row * (slotHeight + CARD_GAP) +
        random() * Math.max(0, slotHeight - height);
      const straddlesZoneEdge = cards.length % 17 === 0;
      const rawX = straddlesZoneEdge
        ? snapToGrid(zone.x + zone.width - width / 2)
        : snapToGrid(slotX);
      const rawY = snapToGrid(slotY);
      cards.push({
        id: idOf("card", cards.length),
        kind: "card",
        x: clamp(rawX, SNAP_MARGIN, ENGINE_CORE_WORLD.width - SNAP_MARGIN - width),
        y: clamp(rawY, zone.y + CARDS_TOP_OFFSET, zone.y + zone.height - CARD_PADDING - height),
        width,
        height,
        tone: "neutral",
        layer: "note-cards",
        parent: zone.id,
      });
    }
  }

  // The remaining cards are free cards at deterministic jittered positions over
  // the whole world, so the board reads as a populated board and not as a grid.
  const freeCardCount = ENGINE_CORE_CARD_COUNT - cards.length;
  if (freeCardCount < 0) {
    throw new RangeError("engine-core scene zone cards exceed the card count");
  }
  for (let index = 0; index < freeCardCount; index += 1) {
    const width = snapToGrid(160 + random() * 128);
    const height = snapToGrid(80 + random() * 112);
    const rawX = snapToGrid(16 + random() * Math.max(0, ENGINE_CORE_WORLD.width - 32 - width));
    const rawY = snapToGrid(16 + random() * Math.max(0, ENGINE_CORE_WORLD.height - 32 - height));
    cards.push({
      id: idOf("card", cards.length),
      kind: "card",
      x: clamp(rawX, SNAP_MARGIN, ENGINE_CORE_WORLD.width - SNAP_MARGIN - width),
      y: clamp(rawY, SNAP_MARGIN, ENGINE_CORE_WORLD.height - SNAP_MARGIN - height),
      width,
      height,
      tone: "neutral",
      layer: "note-cards",
      parent: null,
    });
  }

  const objects: readonly SceneObject[] = [...zones, ...blocks, ...cards];
  return {
    objects,
    metadata: {
      name: "engine-core",
      seed: ENGINE_CORE_SEED,
      world: ENGINE_CORE_WORLD,
      counts: countObjects(objects),
      bounds: boundsOf(objects),
      fit: {
        desktop: fitViewport(ENGINE_CORE_WORLD, 1440, 900),
        mobile: fitViewport(ENGINE_CORE_WORLD, 390, 844),
      },
      camera: { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM },
    },
  };
}

/**
 * Builds the stress scene: `count` rectangles (default 10,000) on a tight grid,
 * cycling through layers and tones. Used by the perf and visual harnesses.
 */
export function buildStressScene(count: number = STRESS_DEFAULT_OBJECT_COUNT): Scene {
  if (!Number.isInteger(count) || count < 0 || count > MAX_SCENE_OBJECT_COUNT) {
    throw new RangeError(
      `stress scene count must be an integer between 0 and ${MAX_SCENE_OBJECT_COUNT}`,
    );
  }
  const columns = count === 0 ? 0 : Math.ceil(Math.sqrt((count * 16) / 9));
  const rows = count === 0 ? 0 : Math.ceil(count / columns);
  const world: SceneWorld = {
    width: Math.max(columns * 32, CANVAS_GRID),
    height: Math.max(rows * 22, CANVAS_GRID),
  };
  const objects: SceneObject[] = [];
  for (let index = 0; index < count; index += 1) {
    const layer = layerAt(index % STRESS_LAYERS.length);
    objects.push({
      id: idOf("stress", index, 5),
      kind: kindOfLayer(layer),
      x: (index % columns) * 32,
      y: Math.floor(index / columns) * 22,
      width: 20,
      height: 14,
      tone: toneAt(index),
      layer,
      parent: null,
    });
  }
  return {
    objects,
    metadata: {
      name: "stress",
      seed: STRESS_SEED,
      world,
      counts: countObjects(objects),
      bounds: boundsOf(objects),
      fit: { desktop: fitViewport(world, 1440, 900), mobile: fitViewport(world, 390, 844) },
      camera: { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM },
    },
  };
}

/** Builds a scene by name; `count` only applies to the stress scene. */
export function buildScene(
  name: SceneName,
  options: { readonly count?: number } = {},
): Scene {
  if (name === "engine-core") {
    return buildEngineCoreScene();
  }
  if (name === "stress") {
    return buildStressScene(options.count ?? STRESS_DEFAULT_OBJECT_COUNT);
  }
  return buildSampleScene();
}

/** Narrows a query parameter to a scene name. */
export function isSceneName(value: string | null): value is SceneName {
  return value === "sample" || value === "stress" || value === "engine-core";
}

function idOf(prefix: "card" | "zone" | "block" | "stress", index: number, padding = 4): string {
  return `${prefix}-${String(index + 1).padStart(padding, "0")}`;
}

function toneAt(index: number): SceneTone {
  const tone = TONE_NAMES[index % TONE_NAMES.length];
  if (tone === undefined) {
    throw new RangeError(`tone index ${index} is out of range`);
  }
  return tone;
}

function layerAt(index: number): SceneLayer {
  const layer = STRESS_LAYERS[index % STRESS_LAYERS.length];
  if (layer === undefined) {
    throw new RangeError(`layer index ${index} is out of range`);
  }
  return layer;
}

function kindOfLayer(layer: SceneLayer): SceneObjectKind {
  switch (layer) {
    case "zones":
      return "zone";
    case "blocks":
      return "block";
    case "note-cards":
      return "card";
  }
}

function randomInteger(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function snapToGrid(value: number): number {
  return Math.round(value / CANVAS_GRID) * CANVAS_GRID;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function shuffledCellIndices(random: () => number, count: number): number[] {
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, 0, index);
    const current = indices[index]!;
    indices[index] = indices[swapIndex]!;
    indices[swapIndex] = current;
  }
  return indices;
}

function countObjects(objects: readonly SceneObject[]): SceneCounts {
  let zones = 0;
  let blocks = 0;
  let cards = 0;
  for (const object of objects) {
    switch (object.kind) {
      case "zone":
        zones += 1;
        break;
      case "block":
        blocks += 1;
        break;
      case "card":
        cards += 1;
        break;
    }
  }
  return { zones, blocks, cards, total: objects.length };
}

function boundsOf(objects: readonly SceneObject[]): SceneBounds {
  if (objects.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    minX = Math.min(minX, object.x);
    minY = Math.min(minY, object.y);
    maxX = Math.max(maxX, object.x + object.width);
    maxY = Math.max(maxY, object.y + object.height);
  }
  return { minX, minY, maxX, maxY };
}

function fitViewport(world: SceneWorld, width: number, height: number): SceneFit {
  const rawZoom = Math.min(width / world.width, height / world.height);
  const zoom = clamp(rawZoom, MINIMUM_ZOOM, MAXIMUM_ZOOM);
  return {
    width,
    height,
    zoom: Math.round(zoom * 10000) / 10000,
    clamped: rawZoom < MINIMUM_ZOOM,
  };
}
