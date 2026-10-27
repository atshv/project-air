// L13 layers scene (P4-06): deterministic, on the canvas grid, and built so the
// fractional keys contradict the design layers.

import assert from "node:assert/strict";
import test from "node:test";

import { LAYERS_WORLD, buildLayersScene, buildScene, isSceneName } from "../src/scenes.ts";

test("the layers scene is deterministic and loadable by name", () => {
  assert.equal(isSceneName("layers"), true);
  assert.deepEqual(buildScene("layers"), buildLayersScene());
  const scene = buildLayersScene();
  assert.equal(scene.metadata.name, "layers");
  assert.deepEqual(scene.metadata.counts, { zones: 2, blocks: 2, cards: 4, total: 8 });
  assert.deepEqual(scene.metadata.world, LAYERS_WORLD);
});

test("every object has a contract key, grid geometry and stays inside the world", () => {
  const ids = new Set();
  for (const object of buildLayersScene().objects) {
    assert.ok(!ids.has(object.id), `${object.id} is unique`);
    ids.add(object.id);
    assert.match(object.z, /^[0-9A-Za-z]{1,64}$/);
    for (const value of [object.x, object.y, object.width, object.height]) {
      assert.equal(value % 16, 0, `${object.id} sits on the 16 px grid`);
    }
    assert.ok(object.x + object.width <= LAYERS_WORLD.width);
    assert.ok(object.y + object.height <= LAYERS_WORLD.height);
  }
});

test("the keys contradict the layers, so only the layer rule can explain the order", () => {
  const objects = buildLayersScene().objects;
  const zoneKeys = objects.filter((object) => object.layer === "zones").map((object) => object.z);
  const cardKeys = objects.filter((object) => object.layer === "note-cards").map((object) => object.z);
  assert.ok(zoneKeys.every((zone) => cardKeys.every((card) => zone > card)),
    "every zone key sorts after every card key");
  const shared = cardKeys.filter((key, index) => cardKeys.indexOf(key) !== index);
  assert.deepEqual(shared, ["a1"], "two cards share a key: insertion order decides");
});
