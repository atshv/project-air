// Determinism and count tests for the engine-core interactive board scene. They
// prove the `perf` gate's document: exactly 10,000 mixed board objects (9,200
// cards, 200 zones, 600 blocks), two builds identical on any machine, every
// object on the 16 px grid inside the world, and the scene dispatch.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ENGINE_CORE_BLOCK_COUNT,
  ENGINE_CORE_CARD_COUNT,
  ENGINE_CORE_OBJECT_COUNT,
  ENGINE_CORE_WORLD,
  ENGINE_CORE_ZONE_COUNT,
  buildEngineCoreScene,
  buildScene,
  isSceneName,
} from "../src/scenes.ts";

const LAYER_ORDER = ["zones", "blocks", "note-cards"];
const TONE_NAMES = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];

function objectsOfKind(scene, kind) {
  return scene.objects.filter((object) => object.kind === kind);
}

test("engine-core board has exactly 10,000 mixed objects", () => {
  const scene = buildEngineCoreScene();
  assert.equal(ENGINE_CORE_OBJECT_COUNT, 10000);
  assert.equal(scene.objects.length, ENGINE_CORE_OBJECT_COUNT);
  assert.deepEqual(scene.metadata.counts, {
    zones: ENGINE_CORE_ZONE_COUNT,
    blocks: ENGINE_CORE_BLOCK_COUNT,
    cards: ENGINE_CORE_CARD_COUNT,
    total: ENGINE_CORE_OBJECT_COUNT,
  });
  assert.equal(ENGINE_CORE_ZONE_COUNT, 200);
  assert.equal(ENGINE_CORE_BLOCK_COUNT, 600);
  assert.equal(ENGINE_CORE_CARD_COUNT, 9200);
  assert.equal(objectsOfKind(scene, "zone").length, ENGINE_CORE_ZONE_COUNT);
  assert.equal(objectsOfKind(scene, "block").length, ENGINE_CORE_BLOCK_COUNT);
  assert.equal(objectsOfKind(scene, "card").length, ENGINE_CORE_CARD_COUNT);
});

test("engine-core board is deterministic across builds", () => {
  const first = buildEngineCoreScene();
  const second = buildEngineCoreScene();
  assert.deepEqual(first, second);
  assert.equal(first.objects[0].id, "zone-0001");
  assert.equal(first.objects[first.objects.length - 1].id, "card-9200");
  assert.deepEqual(first.metadata.bounds, second.metadata.bounds);
  assert.deepEqual(first.metadata.world, ENGINE_CORE_WORLD);
  assert.equal(first.metadata.name, "engine-core");
});

test("engine-core ids are short, stable and unique", () => {
  const scene = buildEngineCoreScene();
  const ids = new Set(scene.objects.map((object) => object.id));
  assert.equal(ids.size, scene.objects.length);
  for (const zone of objectsOfKind(scene, "zone")) {
    assert.match(zone.id, /^zone-\d{4}$/);
  }
  for (const block of objectsOfKind(scene, "block")) {
    assert.match(block.id, /^block-\d{4}$/);
  }
  for (const card of objectsOfKind(scene, "card")) {
    assert.match(card.id, /^card-\d{4}$/);
  }
});

test("engine-core geometry is finite, positive and on the 16 px grid", () => {
  for (const object of buildEngineCoreScene().objects) {
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(Number.isInteger(object[key]), `${object.id}.${key} is an integer`);
      assert.equal(object[key] % 16, 0, `${object.id}.${key} is on the 16 px grid`);
    }
    assert.ok(object.width > 0 && object.height > 0);
    assert.ok(Number.isFinite(object.x) && Number.isFinite(object.y));
  }
});

test("engine-core objects stay inside the world", () => {
  const scene = buildEngineCoreScene();
  for (const object of scene.objects) {
    assert.ok(object.x >= 0, `${object.id} starts inside the world`);
    assert.ok(object.y >= 0, `${object.id} starts inside the world`);
    assert.ok(object.x + object.width <= ENGINE_CORE_WORLD.width, `${object.id} ends inside the world`);
    assert.ok(object.y + object.height <= ENGINE_CORE_WORLD.height, `${object.id} ends inside the world`);
  }
});

test("engine-core follows the layer order and varies in size and tone", () => {
  const scene = buildEngineCoreScene();
  const layerRanks = scene.objects.map((object) => LAYER_ORDER.indexOf(object.layer));
  for (let index = 1; index < layerRanks.length; index += 1) {
    assert.ok(layerRanks[index] >= layerRanks[index - 1], "objects are ordered zones, blocks, cards");
  }
  const zones = objectsOfKind(scene, "zone");
  assert.deepEqual(
    [...new Set(zones.map((zone) => zone.tone))].sort(),
    [...TONE_NAMES].sort(),
    "the engine-core board uses all five zone tones",
  );
  assert.ok(new Set(zones.map((zone) => zone.width)).size > 3, "zones have different widths");
  assert.ok(new Set(zones.map((zone) => zone.height)).size > 3, "zones have different heights");
  assert.ok(
    new Set(objectsOfKind(scene, "card").map((card) => card.width)).size > 3,
    "cards have different widths",
  );
});

test("engine-core blocks sit in their zone and each zone has three", () => {
  const scene = buildEngineCoreScene();
  const zones = new Map(objectsOfKind(scene, "zone").map((zone) => [zone.id, zone]));
  const blocksPerZone = new Map();
  for (const block of objectsOfKind(scene, "block")) {
    const zone = zones.get(block.parent);
    assert.ok(zone, `${block.id} has a containing zone`);
    assert.ok(block.x >= zone.x && block.y >= zone.y, `${block.id} starts inside its zone`);
    assert.ok(
      block.x + block.width <= zone.x + zone.width &&
        block.y + block.height <= zone.y + zone.height,
      `${block.id} ends inside its zone`,
    );
    blocksPerZone.set(block.parent, (blocksPerZone.get(block.parent) ?? 0) + 1);
  }
  for (const zone of zones.values()) {
    assert.equal(blocksPerZone.get(zone.id), 3, `${zone.id} carries three blocks`);
    assert.equal(zone.parent, null);
  }
});

test("engine-core cards are either contained in a zone or free", () => {
  const scene = buildEngineCoreScene();
  const zones = new Map(objectsOfKind(scene, "zone").map((zone) => [zone.id, zone]));
  let contained = 0;
  for (const card of objectsOfKind(scene, "card")) {
    if (card.parent === null) {
      continue;
    }
    contained += 1;
    const zone = zones.get(card.parent);
    assert.ok(zone, `${card.id} has a containing zone`);
    assert.ok(
      card.x < zone.x + zone.width &&
        zone.x < card.x + card.width &&
        card.y < zone.y + zone.height &&
        zone.y < card.y + card.height,
      `${card.id} overlaps its zone`,
    );
  }
  assert.equal(contained, ENGINE_CORE_ZONE_COUNT * 8);
  assert.equal(ENGINE_CORE_CARD_COUNT - contained, 7600);
});

test("engine-core fit clamps the zoom at 1440x900 and 390x844", () => {
  const { metadata } = buildEngineCoreScene();
  assert.deepEqual(metadata.camera, { minimumZoom: 0.1, maximumZoom: 8 });
  assert.equal(metadata.fit.desktop.zoom, 0.1);
  assert.equal(metadata.fit.desktop.clamped, true);
  assert.equal(metadata.fit.mobile.zoom, 0.1);
  assert.equal(metadata.fit.mobile.clamped, true);
});

test("buildScene resolves the engine-core scene and the scene name guard", () => {
  assert.equal(buildScene("engine-core").metadata.name, "engine-core");
  assert.equal(buildScene("engine-core").objects.length, ENGINE_CORE_OBJECT_COUNT);
  assert.equal(isSceneName("engine-core"), true);
  assert.equal(isSceneName("stress"), true);
  assert.equal(isSceneName("sample"), true);
});
