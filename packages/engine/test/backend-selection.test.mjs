// P4-12: capability probe and backend selection with injected fakes. Every branch
// from the brief is covered: no navigator.gpu, adapter null, device rejection,
// probe timeout, WebGPU renderer creation failure, explicit webgpu with/without
// capability, and auto prefer/fallback. The tests assert the stable reason, that
// no exception escapes as a raw error, and that exactly one renderer ends active.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKEND_CODES,
  BACKEND_REASON_CODES,
  BackendSelectionError,
  PROBE_TIMEOUT_MS,
  createBrowserCapabilityProbe,
  selectBackend,
} from "../src/bridge/backend.ts";

const adapterInfo = { vendor: "apple", architecture: "metal-3", description: "ANGLE Metal" };
const availableProbe = (adapter = adapterInfo, state = null) => ({
  probe: async () => {
    if (state !== null) state.probes += 1;
    return { available: true, adapter };
  },
});
const unavailableProbe = (reason, state = null) => ({
  probe: async () => {
    if (state !== null) state.probes += 1;
    return { available: false, reason };
  },
});

function counters() {
  return { webgl2: 0, webgpu: 0, probes: 0 };
}
const factory = (state, kind, { fail = false, value = kind } = {}) => async () => {
  state[kind] += 1;
  if (fail) throw new Error(`${kind} create failed`);
  return { kind: value };
};

test("the reason and backend code tables are stable", () => {
  assert.deepEqual(BACKEND_CODES, { webgl2: 1, webgpu: 2 });
  assert.equal(BACKEND_REASON_CODES.ok, 0);
  assert.equal(BACKEND_REASON_CODES["webgpu-unavailable"], 1);
  assert.equal(BACKEND_REASON_CODES["adapter-null"], 2);
  assert.equal(BACKEND_REASON_CODES["device-rejected"], 3);
  assert.equal(BACKEND_REASON_CODES["probe-timeout"], 4);
  assert.equal(BACKEND_REASON_CODES["renderer-create-failed"], 5);
  assert.equal(BACKEND_REASON_CODES["webgl2-unavailable"], 6);
  assert.equal(PROBE_TIMEOUT_MS, 750);
});

test("no navigator.gpu: the browser probe reports webgpu-unavailable", async () => {
  const probe = createBrowserCapabilityProbe({ gpu: null });
  assert.deepEqual(await probe.probe(), { available: false, reason: "webgpu-unavailable" });
});

test("adapter null and adapter rejection map to adapter-null and webgpu-unavailable", async () => {
  const nullProbe = createBrowserCapabilityProbe({
    gpu: { requestAdapter: async () => null },
  });
  assert.deepEqual(await nullProbe.probe(), { available: false, reason: "adapter-null" });
  const rejectProbe = createBrowserCapabilityProbe({
    gpu: { requestAdapter: async () => { throw new Error("adapter boom"); } },
  });
  assert.deepEqual(await rejectProbe.probe(), { available: false, reason: "webgpu-unavailable" });
});

test("device rejection maps to device-rejected without keeping a device", async () => {
  const probe = createBrowserCapabilityProbe({
    gpu: {
      requestAdapter: async () => ({ info: adapterInfo, requestDevice: async () => { throw new Error("device boom"); } }),
    },
  });
  assert.deepEqual(await probe.probe(), { available: false, reason: "device-rejected" });
});

test("the probe timeout is bounded and returns probe-timeout", async () => {
  const started = Date.now();
  const probe = createBrowserCapabilityProbe({
    timeoutMs: 20,
    gpu: { requestAdapter: () => new Promise(() => {}) },
  });
  assert.deepEqual(await probe.probe(), { available: false, reason: "probe-timeout" });
  assert.ok(Date.now() - started < 500, "the probe returns promptly");
});

test("a successful probe records the adapter identity and destroys the probe device", async () => {
  let destroyed = 0;
  const probe = createBrowserCapabilityProbe({
    gpu: {
      requestAdapter: async () => ({
        info: adapterInfo,
        requestDevice: async () => ({ destroy: () => { destroyed += 1; } }),
      }),
    },
  });
  assert.deepEqual(await probe.probe(), { available: true, adapter: adapterInfo });
  assert.equal(destroyed, 1, "the capability device is released, not leaked");
});

test("explicit webgl2 creates WebGL2 without probing", async () => {
  const state = counters();
  const result = await selectBackend({
    requested: "webgl2",
    probe: { probe: async () => { state.probes += 1; return { available: false, reason: "adapter-null" }; } },
    createWebgl2: factory(state, "webgl2"),
    createWebgpu: factory(state, "webgpu"),
  });
  assert.equal(result.active, "webgl2");
  assert.equal(result.reason, "ok");
  assert.equal(result.fallback, false);
  assert.equal(state.probes, 0, "the default path never probes");
  assert.deepEqual([state.webgl2, state.webgpu], [1, 0]);
});

test("auto prefers WebGPU when the probe passes", async () => {
  const state = counters();
  const result = await selectBackend({
    requested: "auto",
    probe: availableProbe(adapterInfo, state),
    createWebgl2: factory(state, "webgl2"),
    createWebgpu: factory(state, "webgpu"),
  });
  assert.equal(result.active, "webgpu");
  assert.equal(result.reason, "ok");
  assert.deepEqual(result.adapter, adapterInfo);
  assert.equal(result.fallback, false);
  assert.deepEqual([state.webgl2, state.webgpu, state.probes], [0, 1, 1]);
});

test("auto falls back to WebGL2 on every probe failure with its reason", async () => {
  for (const reason of ["webgpu-unavailable", "adapter-null", "device-rejected", "probe-timeout"]) {
    const state = counters();
    const result = await selectBackend({
      requested: "auto",
      probe: unavailableProbe(reason),
      createWebgl2: factory(state, "webgl2"),
      createWebgpu: factory(state, "webgpu"),
    });
    assert.equal(result.active, "webgl2", reason);
    assert.equal(result.reason, reason, reason);
    assert.equal(result.fallback, true, reason);
    assert.equal(result.adapter, null);
    assert.deepEqual([state.webgl2, state.webgpu], [1, 0], "exactly one renderer was created");
  }
});

test("auto falls back when the WebGPU renderer creation fails, with renderer-create-failed", async () => {
  const state = counters();
  const result = await selectBackend({
    requested: "auto",
    probe: availableProbe(),
    createWebgl2: factory(state, "webgl2"),
    createWebgpu: factory(state, "webgpu", { fail: true }),
  });
  assert.equal(result.active, "webgl2");
  assert.equal(result.reason, "renderer-create-failed");
  assert.equal(result.fallback, true);
  assert.deepEqual([state.webgl2, state.webgpu], [1, 1], "the failed attempt left no active WebGPU renderer");
});

test("explicit webgpu without capability fails cleanly with the probe reason", async () => {
  const state = counters();
  for (const reason of ["webgpu-unavailable", "adapter-null", "device-rejected", "probe-timeout"]) {
    await assert.rejects(
      selectBackend({
        requested: "webgpu",
        probe: unavailableProbe(reason),
        createWebgl2: factory(state, "webgl2"),
        createWebgpu: factory(state, "webgpu"),
      }),
      (error) => error instanceof BackendSelectionError && error.code === reason,
      reason,
    );
  }
  assert.deepEqual([state.webgl2, state.webgpu], [0, 0], "no renderer is created on a clean failure");
});

test("explicit webgpu with capability creates WebGPU; creation failure is a clean error", async () => {
  const ok = counters();
  const selected = await selectBackend({
    requested: "webgpu",
    probe: availableProbe(adapterInfo, ok),
    createWebgl2: factory(ok, "webgl2"),
    createWebgpu: factory(ok, "webgpu"),
  });
  assert.equal(selected.active, "webgpu");
  assert.equal(selected.reason, "ok");
  assert.deepEqual(ok, { webgl2: 0, webgpu: 1, probes: 1 });

  const failed = counters();
  await assert.rejects(
    selectBackend({
      requested: "webgpu",
      probe: availableProbe(),
      createWebgl2: factory(failed, "webgl2"),
      createWebgpu: factory(failed, "webgpu", { fail: true }),
    }),
    (error) => error instanceof BackendSelectionError && error.code === "renderer-create-failed",
  );
  assert.deepEqual([failed.webgl2, failed.webgpu], [0, 1], "an explicit request never silently falls back");
});

test("a failing WebGL2 creation fails cleanly as webgl2-unavailable", async () => {
  for (const requested of ["webgl2", "auto"]) {
    const state = counters();
    await assert.rejects(
      selectBackend({
        requested,
        probe: unavailableProbe("webgpu-unavailable"),
        createWebgl2: factory(state, "webgl2", { fail: true }),
        createWebgpu: factory(state, "webgpu"),
      }),
      (error) => error instanceof BackendSelectionError && error.code === "webgl2-unavailable",
      requested,
    );
  }
});
