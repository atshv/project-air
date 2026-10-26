// Determinism and count tests for the test-kit scenes. They prove acceptance A2
// of P4-02: the sample board always has 500 cards and 50 zones with contained
// blocks, the stress scene defaults to 10,000 objects, and two builds on any
// machine are identical (seeded PRNG, no Math.random, no Date).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_SCENE_OBJECT_COUNT,
  SAMPLE_CARD_COUNT,
  SAMPLE_WORLD,
  SAMPLE_ZONE_COUNT,
  STRESS_DEFAULT_OBJECT_COUNT,
  buildSampleScene,
  buildScene,
  buildStressScene,
  createSeededRandom,
  isSceneName,
} from "../src/scenes.ts";

const SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "scenes.ts");
const LAYER_ORDER = ["zones", "blocks", "note-cards"];
const TONE_NAMES = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
const CARD_ID = /^card-\d{4}$/;
const STRESS_ID = /^stress-\d{5}$/;

function objectsOfKind(scene, kind) {
  return scene.objects.filter((object) => object.kind === kind);
}

function zoneById(scene) {
  return new Map(objectsOfKind(scene, "zone").map((zone) => [zone.id, zone]));
}

function overlaps(left, right) {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

test("sample board has exactly 500 cards and 50 zones with contained blocks", () => {
  const scene = buildSampleScene();
  const zones = objectsOfKind(scene, "zone");
  const blocks = objectsOfKind(scene, "block");
  const cards = objectsOfKind(scene, "card");
  assert.equal(zones.length, SAMPLE_ZONE_COUNT);
  assert.equal(cards.length, SAMPLE_CARD_COUNT);
  assert.equal(scene.metadata.counts.zones, SAMPLE_ZONE_COUNT);
  assert.equal(scene.metadata.counts.blocks, blocks.length);
  assert.equal(scene.metadata.counts.cards, SAMPLE_CARD_COUNT);
  assert.equal(scene.metadata.counts.total, scene.objects.length);
  // Every zone carries two to four blocks and every block names its zone.
  const blocksPerZone = new Map();
  for (const block of blocks) {
    assert.notEqual(block.parent, null, `${block.id} names its containing zone`);
    blocksPerZone.set(block.parent, (blocksPerZone.get(block.parent) ?? 0) + 1);
  }
  for (const zone of zones) {
    const count = blocksPerZone.get(zone.id) ?? 0;
    assert.ok(count >= 2 && count <= 4, `${zone.id} carries two to four blocks (got ${count})`);
  }
  assert.equal(blocksPerZone.size, zones.length, "no block is orphaned and no zone is empty");
  assert.equal(blocks.length, 144);
});

test("sample board is deterministic across builds", () => {
  const first = buildSampleScene();
  const second = buildSampleScene();
  assert.deepEqual(first, second);
  assert.equal(first.objects[0].id, "zone-0001");
  assert.equal(first.objects[first.objects.length - 1].id, "card-0500");
  assert.deepEqual(first.metadata.bounds, second.metadata.bounds);
  assert.deepEqual(first.metadata.world, SAMPLE_WORLD);
});

test("sample ids are short, stable and unique", () => {
  const scene = buildSampleScene();
  const ids = new Set(scene.objects.map((object) => object.id));
  assert.equal(ids.size, scene.objects.length);
  for (const card of objectsOfKind(scene, "card")) {
    assert.match(card.id, CARD_ID);
  }
  for (const zone of objectsOfKind(scene, "zone")) {
    assert.match(zone.id, /^zone-\d{4}$/);
  }
  for (const block of objectsOfKind(scene, "block")) {
    assert.match(block.id, /^block-\d{4}$/);
  }
});

test("sample geometry is finite, positive and on the 16 px grid", () => {
  for (const object of buildSampleScene().objects) {
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(Number.isInteger(object[key]), `${object.id}.${key} is an integer`);
      assert.equal(object[key] % 16, 0, `${object.id}.${key} is on the 16 px grid`);
    }
    assert.ok(object.width > 0 && object.height > 0);
    assert.ok(Number.isFinite(object.x) && Number.isFinite(object.y));
  }
});

test("sample stays inside the world and reaches its edges", () => {
  const scene = buildSampleScene();
  for (const object of scene.objects) {
    assert.ok(object.x >= 0, `${object.id} starts inside the world`);
    assert.ok(object.y >= 0, `${object.id} starts inside the world`);
    assert.ok(object.x + object.width <= SAMPLE_WORLD.width, `${object.id} ends inside the world`);
    assert.ok(object.y + object.height <= SAMPLE_WORLD.height, `${object.id} ends inside the world`);
  }
  assert.ok(scene.metadata.bounds.minX <= 64, "a card or zone sits near the left world edge");
  assert.ok(scene.metadata.bounds.minY <= 64, "a card or zone sits near the top world edge");
  assert.ok(
    scene.metadata.bounds.maxX >= SAMPLE_WORLD.width - 64,
    "a card or zone sits near the right world edge",
  );
  assert.ok(
    scene.metadata.bounds.maxY >= SAMPLE_WORLD.height - 64,
    "a card or zone sits near the bottom world edge",
  );
});

test("sample objects follow the layer order and vary in size and tone", () => {
  const scene = buildSampleScene();
  const layerRanks = scene.objects.map((object) => LAYER_ORDER.indexOf(object.layer));
  for (let index = 1; index < layerRanks.length; index += 1) {
    assert.ok(layerRanks[index] >= layerRanks[index - 1], "objects are ordered zones, blocks, cards");
  }
  const zones = objectsOfKind(scene, "zone");
  assert.deepEqual(
    [...new Set(zones.map((zone) => zone.tone))].sort(),
    [...TONE_NAMES].sort(),
    "the sample board uses all five zone tones",
  );
  assert.ok(new Set(zones.map((zone) => zone.width)).size > 3, "zones have different widths");
  assert.ok(new Set(zones.map((zone) => zone.height)).size > 3, "zones have different heights");
  const cardHeights = new Set(objectsOfKind(scene, "card").map((card) => card.height));
  assert.ok(cardHeights.size > 3, "cards have different heights");
});

test("sample blocks and zone cards are contained in their zone", () => {
  const scene = buildSampleScene();
  const zones = zoneById(scene);
  for (const block of objectsOfKind(scene, "block")) {
    const zone = zones.get(block.parent);
    assert.ok(zone, `${block.id} has a containing zone`);
    assert.ok(block.x >= zone.x, `${block.id} starts inside its zone`);
    assert.ok(block.y >= zone.y, `${block.id} starts inside its zone`);
    assert.ok(block.x + block.width <= zone.x + zone.width, `${block.id} ends inside its zone`);
    assert.ok(block.y + block.height <= zone.y + zone.height, `${block.id} ends inside its zone`);
  }
  for (const card of objectsOfKind(scene, "card")) {
    if (card.parent === null) {
      continue;
    }
    const zone = zones.get(card.parent);
    assert.ok(zone, `${card.id} has a containing zone`);
    assert.ok(
      overlaps(card, zone),
      `${card.id} overlaps its zone, so the card-over-zone layer order is visible`,
    );
  }
  for (const zone of objectsOfKind(scene, "zone")) {
    assert.equal(zone.parent, null);
  }
});

test("sample fit clamps the zoom at 1440x900 and 390x844", () => {
  const { metadata } = buildSampleScene();
  assert.deepEqual(metadata.camera, { minimumZoom: 0.1, maximumZoom: 8 });
  assert.equal(metadata.fit.desktop.width, 1440);
  assert.equal(metadata.fit.desktop.height, 900);
  assert.equal(metadata.fit.desktop.zoom, 0.15);
  assert.equal(metadata.fit.desktop.clamped, false);
  assert.equal(metadata.fit.mobile.width, 390);
  assert.equal(metadata.fit.mobile.height, 844);
  assert.equal(metadata.fit.mobile.zoom, 0.1);
  assert.equal(metadata.fit.mobile.clamped, true);
});

test("stress scene defaults to 10,000 deterministic objects", () => {
  const first = buildStressScene();
  const second = buildStressScene();
  assert.deepEqual(first, second);
  assert.equal(first.objects.length, STRESS_DEFAULT_OBJECT_COUNT);
  assert.equal(first.metadata.counts.total, STRESS_DEFAULT_OBJECT_COUNT);
  assert.equal(first.metadata.counts.cards + first.metadata.counts.zones + first.metadata.counts.blocks, STRESS_DEFAULT_OBJECT_COUNT);
  const ids = new Set(first.objects.map((object) => object.id));
  assert.equal(ids.size, STRESS_DEFAULT_OBJECT_COUNT);
  for (const object of first.objects) {
    assert.match(object.id, STRESS_ID);
    assert.ok(object.x + object.width <= first.metadata.world.width);
    assert.ok(object.y + object.height <= first.metadata.world.height);
  }
  assert.equal(first.metadata.fit.desktop.clamped, false);
  assert.ok(first.metadata.fit.desktop.zoom >= 0.1);
});

test("stress scene handles the empty and maximum document sizes", () => {
  const empty = buildStressScene(0);
  assert.deepEqual(empty.objects, []);
  assert.deepEqual(empty.metadata.counts, { zones: 0, blocks: 0, cards: 0, total: 0 });
  assert.ok(empty.metadata.world.width > 0 && empty.metadata.world.height > 0);
  assert.deepEqual(empty.metadata.bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 });

  const maximum = buildStressScene(MAX_SCENE_OBJECT_COUNT);
  assert.equal(maximum.objects.length, MAX_SCENE_OBJECT_COUNT);
  assert.equal(new Set(maximum.objects.map((object) => object.id)).size, MAX_SCENE_OBJECT_COUNT);
  assert.equal(maximum.metadata.fit.desktop.clamped, false);

  assert.throws(() => buildStressScene(MAX_SCENE_OBJECT_COUNT + 1), RangeError);
  assert.throws(() => buildStressScene(-1), RangeError);
  assert.throws(() => buildStressScene(1.5), RangeError);
});

test("buildScene resolves scene names and forwards the stress count", () => {
  assert.equal(buildScene("sample").metadata.name, "sample");
  assert.equal(buildScene("stress").objects.length, STRESS_DEFAULT_OBJECT_COUNT);
  assert.equal(buildScene("stress", { count: 3 }).objects.length, 3);
  assert.equal(isSceneName("sample"), true);
  assert.equal(isSceneName("stress"), true);
  assert.equal(isSceneName("bench"), false);
  assert.equal(isSceneName(null), false);
});

test("the seeded PRNG repeats and the source uses no ambient randomness", () => {
  const first = createSeededRandom(42);
  const second = createSeededRandom(42);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(first(), second());
  }
  assert.notEqual(createSeededRandom(1)(), createSeededRandom(2)());

  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.doesNotMatch(source, /Math\.random/, "scene builders must not use Math.random");
  assert.doesNotMatch(source, /\bDate\s*[.(]/, "scene builders must not use Date");
});
