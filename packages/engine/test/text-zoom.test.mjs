// Zoom-bucket tests of the runtime atlas (P4-10, L02 sharp text).
//
// The atlas re-rasterises only when the camera crosses a power-of-two zoom
// bucket; the raster scale is the smaller of the bucket times the device pixel
// ratio and the documented 4x cap. The P4-09 layout stays in CSS px, so a bucket
// change never re-breaks a line — this test pins the bucket arithmetic and the
// bounded set of scales a session can rasterise.

import assert from "node:assert/strict";
import test from "node:test";

import {
  atlasRasterScale,
  atlasZoomBucket,
  MAX_ATLAS_RASTER_SCALE,
  MAX_ATLAS_ZOOM_BUCKET,
  MIN_ATLAS_ZOOM_BUCKET,
} from "../src/bridge/text-atlas.ts";

test("the zoom buckets are the documented 25/50/100/200/400 percent set", () => {
  assert.equal(MIN_ATLAS_ZOOM_BUCKET, 0.25);
  assert.equal(MAX_ATLAS_ZOOM_BUCKET, 4);
  assert.equal(atlasZoomBucket(0.1), 0.25);
  assert.equal(atlasZoomBucket(0.25), 0.25);
  assert.equal(atlasZoomBucket(0.3), 0.5);
  assert.equal(atlasZoomBucket(0.5), 0.5);
  assert.equal(atlasZoomBucket(0.75), 1);
  assert.equal(atlasZoomBucket(1), 1);
  assert.equal(atlasZoomBucket(1.5), 2);
  assert.equal(atlasZoomBucket(2), 2);
  assert.equal(atlasZoomBucket(2.5), 4);
  assert.equal(atlasZoomBucket(4), 4);
  // The camera maximum 8 maps to the capped bucket.
  assert.equal(atlasZoomBucket(8), 4);
  assert.equal(atlasZoomBucket(Number.NaN), 1);
  assert.equal(atlasZoomBucket(0), 1);
  assert.equal(atlasZoomBucket(-1), 1);
});

test("the raster scale is the bucket times the DPR, capped at 4x", () => {
  assert.equal(atlasRasterScale(1, 1), 1);
  assert.equal(atlasRasterScale(2, 1), 2);
  assert.equal(atlasRasterScale(1, 2), 2);
  assert.equal(atlasRasterScale(2, 2), 4);
  assert.equal(atlasRasterScale(3, 2), MAX_ATLAS_RASTER_SCALE);
  assert.equal(atlasRasterScale(1, 0.25), 0.25);
  assert.equal(atlasRasterScale(1, 0.5), 0.5);
  assert.equal(atlasRasterScale(2, 0.5), 1);
  assert.equal(atlasRasterScale(1, 8), MAX_ATLAS_RASTER_SCALE);
  // An invalid DPR falls back to 1 instead of producing NaN/Infinity.
  assert.equal(atlasRasterScale(Number.NaN, 1), 1);
  assert.equal(atlasRasterScale(0, 1), 1);
  assert.equal(atlasRasterScale(-2, 2), 2);
});

test("a session rasterises a bounded number of atlas scales", () => {
  const scales = new Set();
  for (let zoom = 0.1; zoom <= 8; zoom *= 1.01) {
    scales.add(atlasRasterScale(1, zoom));
  }
  // 25 %, 50 %, 100 %, 200 %, 400 % — at most five rebuilds per device pixel ratio.
  assert.deepEqual([...scales].sort((left, right) => left - right), [0.25, 0.5, 1, 2, 4]);
  const retinaScales = new Set();
  for (let zoom = 0.1; zoom <= 8; zoom *= 1.01) {
    retinaScales.add(atlasRasterScale(2, zoom));
  }
  // DPR 2 caps at 4x earlier, so the 400 % bucket repeats the 200 % scale.
  assert.deepEqual(
    [...retinaScales].sort((left, right) => left - right),
    [0.5, 1, 2, 4],
  );
});

test("a zoom inside a bucket keeps the same raster scale", () => {
  // A plain pan does not change the zoom at all; a small zoom change inside the
  // bucket must not rebuild the atlas either (bounded rebuilds).
  assert.equal(atlasRasterScale(1, 1.01), atlasRasterScale(1, 1.99));
  assert.equal(atlasRasterScale(1, 0.3), atlasRasterScale(1, 0.49));
  assert.equal(atlasRasterScale(1, 1.01), 2);
  assert.notEqual(atlasRasterScale(1, 2.0), atlasRasterScale(1, 2.01));
});
