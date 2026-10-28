// P4-11/P4-13: WebGPU render pipeline behind the command buffer.
//
// The WebGPU backend consumes the same core data as WebGL2: the 24-byte
// `air::engine::Instance` command-buffer records for the object pass, and the
// shared text/chrome core's `GlyphInstance` and chrome quads for the glyph and
// chrome passes. One EM_JS helper owns the browser WebGPU objects; C++ owns the
// frame decision, the document/camera state, the buffer bytes and the passes'
// geometry. Draw order matches WebGL2: grid (background), objects, chrome, glyphs.
//
// The grid and the text/chrome pipelines are P4-13; they reuse the tokens
// (canvas_grid, border_width, faint, fg) parsed on the C++ side, so no raw design
// value lives in the JS/WGSL. Native builds fail every entry point cleanly.

#include "engine/render_webgpu.h"

#include <cmath>
#include <cstddef>
#include <cstring>
#include <string>

#include "tokens.h"

namespace air::engine::webgpu {

#if defined(__EMSCRIPTEN__)

#include <emscripten.h>

namespace {
std::string g_error = "WebGPU renderer has not been created";

const char* messageFor(int code) {
  switch (code) {
    case 0:
      return "WebGPU device is still initialising";
    case 1:
      return "WebGPU is not available in this browser (navigator.gpu missing)";
    case 2:
      return "WebGPU canvas selector did not match a canvas element";
    case 3:
      return "WebGPU adapter request failed (no compatible adapter)";
    case 4:
      return "WebGPU device request failed";
    case 5:
      return "WebGPU canvas context could not be created or configured";
    case 6:
      return "WebGPU pipeline creation failed";
    case 7:
      return "WebGPU frame upload or draw failed";
    default:
      return "WebGPU renderer is unavailable";
  }
}

bool parseRgba(const char* rgba, float out[4]) {
  if (rgba == nullptr) {
    return false;
  }
  double values[4] = {};
  int found = 0;
  const char* cursor = rgba;
  while (*cursor != '\0' && found < 4) {
    if ((*cursor >= '0' && *cursor <= '9') || *cursor == '.') {
      char* end = nullptr;
      values[found] = std::strtod(cursor, &end);
      if (end == cursor) {
        return false;
      }
      cursor = end;
      found += 1;
      continue;
    }
    cursor += 1;
  }
  if (found < 3) {
    return false;
  }
  out[0] = static_cast<float>(values[0] / 255.0);
  out[1] = static_cast<float>(values[1] / 255.0);
  out[2] = static_cast<float>(values[2] / 255.0);
  out[3] = found == 4 ? static_cast<float>(values[3]) : 1.0F;
  return true;
}
}  // namespace

// Starts the asynchronous device/pipeline creation and returns immediately.
EM_JS(int, air_webgpu_create_js, (const char* selector, const float* palette, const float* clear), {
  const state = globalThis.__airWebgpu = {
    status: 0, code: 0, error: "", errors: [], adapterInfo: null,
    device: null, context: null, format: null, pipeline: null,
    uniformBuffer: null, paletteBuffer: null, bindGroup: null,
    instanceBuffer: null, capacity: 0, canvas: null, configured: "", palette: [], clear: [],
    gridPipeline: null, gridUniform: null, gridBindGroup: null, gridVisible: false,
    chromePipeline: null, chromeUniform: null, chromeBindGroup: null,
    chromeBuffer: null, chromeCapacity: 0,
    glyphPipeline: null, glyphUniform: null, glyphBindGroup: null,
    glyphBuffer: null, glyphCapacity: 0, glyphTint: [1, 1, 1, 1],
    atlasTexture: null, atlasKey: "", sampler: null,
  };
  for (let i = 0; i < 18; i += 1) state.palette.push(HEAPF32[(palette >> 2) + i]);
  for (let i = 0; i < 3; i += 1) state.clear.push(HEAPF32[(clear >> 2) + i]);
  if (typeof navigator === "undefined" || navigator.gpu === undefined) {
    state.status = -1; state.code = 1; state.error = "navigator.gpu missing"; return 0;
  }
  const canvas = document.querySelector(UTF8ToString(selector));
  if (canvas === null) { state.status = -1; state.code = 2; state.error = "canvas not found"; return 0; }
  state.canvas = canvas;
  const blend = {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
  const objectWgsl = [
    "struct Uniforms { resolution: vec2<f32>, pad: vec2<f32> };",
    "@group(0) @binding(0) var<uniform> uniforms: Uniforms;",
    "@group(0) @binding(1) var<uniform> palette: array<vec4<f32>, 6>;",
    "struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) @interpolate(flat) tone: u32 };",
    "@vertex fn vertex_main(@builtin(vertex_index) vertex_index: u32,",
    "  @location(0) rect: vec4<f32>, @location(1) tone: u32, @location(2) layer: u32) -> VertexOut {",
    "  var corners = array<vec2<f32>, 6>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),",
    "    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));",
    "  let corner = corners[vertex_index % 6u];",
    "  let position = rect.xy + corner * rect.zw;",
    "  let clip = vec2<f32>(position.x / uniforms.resolution.x * 2.0 - 1.0,",
    "                       1.0 - position.y / uniforms.resolution.y * 2.0);",
    "  var out: VertexOut; out.position = vec4<f32>(clip, 0.0, 1.0); out.tone = tone; return out;",
    "}",
    "@fragment fn fragment_main(in: VertexOut) -> @location(0) vec4<f32> { return palette[in.tone]; }",
  ].join("\n");
  const chromeWgsl = [
    "struct Uniforms { resolution: vec2<f32>, pad: vec2<f32> };",
    "@group(0) @binding(0) var<uniform> uniforms: Uniforms;",
    "struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) @interpolate(flat) tint: vec4<f32> };",
    "@vertex fn vertex_main(@builtin(vertex_index) vertex_index: u32,",
    "  @location(0) rect: vec4<f32>, @location(1) tint: vec4<f32>) -> VertexOut {",
    "  var corners = array<vec2<f32>, 6>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),",
    "    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));",
    "  let corner = corners[vertex_index % 6u];",
    "  let position = rect.xy + corner * rect.zw;",
    "  let clip = vec2<f32>(position.x / uniforms.resolution.x * 2.0 - 1.0,",
    "                       1.0 - position.y / uniforms.resolution.y * 2.0);",
    "  var out: VertexOut; out.position = vec4<f32>(clip, 0.0, 1.0); out.tint = tint; return out;",
    "}",
    "@fragment fn fragment_main(in: VertexOut) -> @location(0) vec4<f32> { return in.tint; }",
  ].join("\n");
  const glyphWgsl = [
    "struct GlyphUniforms { resolution: vec2<f32>, pad: vec2<f32>, tint: vec4<f32> };",
    "@group(0) @binding(0) var<uniform> glyph: GlyphUniforms;",
    "@group(0) @binding(1) var atlas: texture_2d<f32>;",
    "@group(0) @binding(2) var atlasSampler: sampler;",
    "struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };",
    "@vertex fn vertex_main(@builtin(vertex_index) vertex_index: u32,",
    "  @location(0) rect: vec4<f32>, @location(1) uv: vec4<f32>) -> VertexOut {",
    "  var corners = array<vec2<f32>, 6>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),",
    "    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));",
    "  let corner = corners[vertex_index % 6u];",
    "  let position = rect.xy + corner * rect.zw;",
    "  let clip = vec2<f32>(position.x / glyph.resolution.x * 2.0 - 1.0,",
    "                       1.0 - position.y / glyph.resolution.y * 2.0);",
    "  var out: VertexOut; out.position = vec4<f32>(clip, 0.0, 1.0);",
    "  out.uv = mix(uv.xy, uv.zw, corner); return out;",
    "}",
    "@fragment fn fragment_main(in: VertexOut) -> @location(0) vec4<f32> {",
    "  let coverage = textureSample(atlas, atlasSampler, in.uv).a;",
    "  if (coverage <= 0.0) { discard; }",
    "  return vec4<f32>(glyph.tint.rgb, glyph.tint.a * coverage);",
    "}",
  ].join("\n");
  (async () => {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter === null) { state.status = -1; state.code = 3; return; }
      state.adapterInfo = adapter.info === undefined ? null
        : { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
      const device = await adapter.requestDevice();
      state.device = device;
      device.addEventListener("uncapturederror", (event) => {
        state.status = -1; state.code = 7;
        state.errors = state.errors || [];
        state.errors.push(String(event.error && event.error.message ? event.error.message : event.error));
        state.error = state.errors[0];
      });
      const context = canvas.getContext("webgpu");
      if (context === null) { state.status = -1; state.code = 5; return; }
      state.context = context;
      state.format = navigator.gpu.getPreferredCanvasFormat();
      const makePipeline = (code, vertexBuffers, fragmentTargets) => {
        const module = device.createShaderModule({ code });
        return device.createRenderPipeline({
          layout: "auto",
          vertex: { module, entryPoint: "vertex_main", buffers: vertexBuffers },
          fragment: { module, entryPoint: "fragment_main", targets: fragmentTargets },
          primitive: { topology: "triangle-list" },
        });
      };
      const blendTarget = { format: state.format, blend };
      state.pipeline = makePipeline(objectWgsl, [{ arrayStride: 24, stepMode: "instance", attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x4" },
        { shaderLocation: 1, offset: 16, format: "uint32" },
        { shaderLocation: 2, offset: 20, format: "uint32" }] }], [{ format: state.format }]);
      state.chromePipeline = makePipeline(chromeWgsl, [{ arrayStride: 32, stepMode: "instance", attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x4" },
        { shaderLocation: 1, offset: 16, format: "float32x4" }] }], [blendTarget]);
      state.glyphPipeline = makePipeline(glyphWgsl, [{ arrayStride: 32, stepMode: "instance", attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x4" },
        { shaderLocation: 1, offset: 16, format: "float32x4" }] }], [blendTarget]);
      const uniform = () => device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      state.uniformBuffer = uniform();
      state.chromeUniform = uniform();
      state.glyphUniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      state.paletteBuffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const paletteData = new Float32Array(24);
      for (let i = 0; i < 6; i += 1) {
        paletteData[i * 4 + 0] = state.palette[i * 3 + 0];
        paletteData[i * 4 + 1] = state.palette[i * 3 + 1];
        paletteData[i * 4 + 2] = state.palette[i * 3 + 2];
        paletteData[i * 4 + 3] = 1.0;
      }
      device.queue.writeBuffer(state.paletteBuffer, 0, paletteData);
      state.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear",
        addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
      state.status = 1;
    } catch (error) {
      state.status = -1; state.code = 6;
      state.error = String(error && error.message ? error.message : error);
    }
  })();
  return 1;
});

EM_JS(int, air_webgpu_resize_js, (int css_width, int css_height, float dpr), {
  const state = globalThis.__airWebgpu;
  if (state === undefined) return 0;
  state.cssWidth = css_width; state.cssHeight = css_height; state.dpr = dpr;
  return 1;
});

EM_JS(void, air_webgpu_shutdown_js, (), {
  const state = globalThis.__airWebgpu;
  if (state === undefined) return;
  if (state.device !== null && state.device !== undefined && state.device.destroy !== undefined) {
    try { state.device.destroy(); } catch (error) { /* already lost */ }
  }
  globalThis.__airWebgpu = undefined;
});

EM_JS(int, air_webgpu_status_js, (), {
  const state = globalThis.__airWebgpu;
  return state === undefined ? -2 : state.status;
});

EM_JS(int, air_webgpu_error_code_js, (), {
  const state = globalThis.__airWebgpu;
  return state === undefined ? 99 : state.code;
});

EM_JS(int, air_webgpu_frame_js, (const void* bytes, int count, int css_width, int css_height, float dpr,
                                 double pan_x, double pan_y, double zoom, int grid_visible,
                                 float grid_spacing, float grid_radius, float faint_r, float faint_g, float faint_b, float faint_a), {
  const state = globalThis.__airWebgpu;
  if (state === undefined || state.status !== 1) return 0;
  const recordCount = Number(count);
  const byteCount = recordCount * 24;
  if (recordCount > 0 && bytes !== 0) {
    const needed = Math.max(1024, recordCount);
    if (state.instanceBuffer === null || state.capacity < needed) {
      let capacity = state.capacity === 0 ? 1024 : state.capacity;
      while (capacity < needed) capacity *= 2;
      if (state.instanceBuffer !== null) state.instanceBuffer.destroy();
      state.instanceBuffer = state.device.createBuffer({ size: capacity * 24,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      state.capacity = capacity;
      state.bindGroup = null;
    }
    state.device.queue.writeBuffer(state.instanceBuffer, 0,
      new Uint8Array(HEAPU8.buffer, bytes, byteCount), 0, byteCount);
  }
  const canvas = state.canvas;
  const width = Math.max(1, Math.round(Number(css_width) * Number(dpr)));
  const height = Math.max(1, Math.round(Number(css_height) * Number(dpr)));
  if (canvas !== null && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width; canvas.height = height;
    state.bindGroup = null; state.chromeBindGroup = null; state.glyphBindGroup = null;
  }
  const key = width + "x" + height + ":" + state.format;
  if (state.configured !== key) {
    state.context.configure({ device: state.device, format: state.format, alphaMode: "opaque" });
    state.configured = key;
  }
  state.device.queue.writeBuffer(state.uniformBuffer, 0, new Float32Array([Number(css_width), Number(css_height), 0, 0]));
  if (state.bindGroup === null) {
    state.bindGroup = state.device.createBindGroup({
      layout: state.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: state.uniformBuffer } },
        { binding: 1, resource: { buffer: state.paletteBuffer } },
      ],
    });
  }
  // P4-13 grid: the same screen-space dot pattern as the WebGL2 pass, drawn as
  // one full-screen triangle below the objects.
  const gridWgsl = [
    "struct Grid { pan: vec2<f32>, zoom: f32, spacing: f32, dpr: f32, radius: f32, resolution: vec2<f32> };",
    "@group(0) @binding(0) var<uniform> grid: Grid;",
    "const GRID_COLOR = vec4<f32>(" + Number(faint_r) + ", " + Number(faint_g) + ", " + Number(faint_b) + ", " + Number(faint_a) + ");",
    "struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) pixel: vec2<f32> };",
    "@vertex fn vertex_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {",
    "  var corners = array<vec2<f32>, 6>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),",
    "    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));",
    "  let corner = corners[vertex_index % 6u];",
    "  let pixel = corner * grid.resolution;",
    "  let clip = vec2<f32>(pixel.x / grid.resolution.x * 2.0 - 1.0, 1.0 - pixel.y / grid.resolution.y * 2.0);",
    "  var out: VertexOut; out.position = vec4<f32>(clip, 0.0, 1.0); out.pixel = pixel; return out;",
    "}",
    "@fragment fn fragment_main(in: VertexOut) -> @location(0) vec4<f32> {",
    "  let css = in.pixel / grid.dpr;",
    "  let world = grid.pan + css / grid.zoom;",
    "  let nearest = floor(world / grid.spacing + 0.5) * grid.spacing;",
    "  let distance = length((world - nearest) * grid.zoom);",
    "  let coverage = 1.0 - smoothstep(grid.radius - 0.5, grid.radius + 0.5, distance);",
    "  if (coverage <= 0.0) { discard; }",
    "  return vec4<f32>(GRID_COLOR.rgb, GRID_COLOR.a * coverage);",
    "}",
  ].join("\n");
  const gridUniformData = new Float32Array([Number(pan_x), Number(pan_y), Number(zoom),
    Number(grid_spacing), Number(dpr), Number(grid_radius), Number(css_width), Number(css_height)]);
  const encoder = state.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: state.context.getCurrentTexture().createView(),
      clearValue: { r: state.clear[0], g: state.clear[1], b: state.clear[2], a: 1.0 },
      loadOp: "clear", storeOp: "store",
    }],
  });
  if (grid_visible !== 0) {
    if (state.gridPipeline === null) {
      const module = state.device.createShaderModule({ code: gridWgsl });
      state.gridPipeline = state.device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vertex_main" },
        fragment: { module, entryPoint: "fragment_main", targets: [{ format: state.format, blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } } }] },
        primitive: { topology: "triangle-list" },
      });
      state.gridUniform = state.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      state.gridBindGroup = state.device.createBindGroup({ layout: state.gridPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: state.gridUniform } }] });
    }
    state.device.queue.writeBuffer(state.gridUniform, 0, gridUniformData);
    pass.setPipeline(state.gridPipeline);
    pass.setBindGroup(0, state.gridBindGroup);
      pass.draw(6);
  }
  if (recordCount > 0 && state.instanceBuffer !== null) {
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, state.bindGroup);
    pass.setVertexBuffer(0, state.instanceBuffer);
    pass.draw(6, recordCount);
  }
  pass.end();
  state.device.queue.submit([encoder.finish()]);
  return 1;
});

EM_JS(int, air_webgpu_post_frame_js, (const void* glyphs_a, int count_a, const void* glyphs_b,
                                     int count_b, const void* chrome, int chrome_count,
                                     const void* atlas, int atlas_width, int atlas_height,
                                     int atlas_ready, const float* tint), {
  const state = globalThis.__airWebgpu;
  if (state === undefined || state.status !== 1) return 0;
  const hasGlyphs = Number(count_a) + Number(count_b) > 0;
  const hasChrome = Number(chrome_count) > 0;
  if (!hasGlyphs && !hasChrome) return 1;
  try {
  const canvas = state.canvas;
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const resolution = new Float32Array([canvas.width / (state.dpr === undefined ? 1 : state.dpr),
    canvas.height / (state.dpr === undefined ? 1 : state.dpr), 0, 0]);
  const run = canvas.width > 0 && canvas.height > 0;
  if (!run) return 1;
  // The uniform resolution is the CSS size the quads are expressed in.
  const cssWidth = state.cssWidth === undefined ? canvas.width : state.cssWidth;
  const cssHeight = state.cssHeight === undefined ? canvas.height : state.cssHeight;
  const encoder = state.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: state.context.getCurrentTexture().createView(),
      loadOp: "load", storeOp: "store",
    }],
  });
  if (hasChrome) {
    const needed = Math.max(256, Number(chrome_count));
    if (state.chromeBuffer === null || state.chromeCapacity < needed) {
      let capacity = state.chromeCapacity === 0 ? 256 : state.chromeCapacity;
      while (capacity < needed) capacity *= 2;
      if (state.chromeBuffer !== null) state.chromeBuffer.destroy();
      state.chromeBuffer = state.device.createBuffer({ size: capacity * 32,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      state.chromeCapacity = capacity;
      state.chromeBindGroup = null;
    }
    state.device.queue.writeBuffer(state.chromeBuffer, 0,
      new Uint8Array(HEAPU8.buffer, chrome, Number(chrome_count) * 32), 0, Number(chrome_count) * 32);
    state.device.queue.writeBuffer(state.chromeUniform, 0, new Float32Array([cssWidth, cssHeight, 0, 0]));
    if (state.chromeBindGroup === null) {
      state.chromeBindGroup = state.device.createBindGroup({ layout: state.chromePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: state.chromeUniform } }] });
    }
    pass.setPipeline(state.chromePipeline);
    pass.setBindGroup(0, state.chromeBindGroup);
    pass.setVertexBuffer(0, state.chromeBuffer);
    pass.draw(6, Number(chrome_count));
  }
  if (hasGlyphs) {
    if (Number(atlas_ready) !== 0 && Number(atlas_width) > 0 && Number(atlas_height) > 0) {
      const key = atlas_width + "x" + atlas_height + ":" + atlas;
      if (state.atlasKey !== key) {
        if (state.atlasTexture !== null) state.atlasTexture.destroy();
        state.atlasTexture = state.device.createTexture({
          size: { width: Number(atlas_width), height: Number(atlas_height), depthOrArrayLayers: 1 },
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        state.device.queue.writeTexture({ texture: state.atlasTexture },
          new Uint8Array(HEAPU8.buffer, atlas, Number(atlas_width) * Number(atlas_height) * 4),
          { bytesPerRow: Number(atlas_width) * 4, rowsPerImage: Number(atlas_height) },
          { width: Number(atlas_width), height: Number(atlas_height), depthOrArrayLayers: 1 });
        state.atlasKey = key;
        state.glyphBindGroup = null;
      }
      if (state.glyphBindGroup === null) {
        state.glyphBindGroup = state.device.createBindGroup({ layout: state.glyphPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: state.glyphUniform } },
            { binding: 1, resource: state.atlasTexture.createView() },
            { binding: 2, resource: state.sampler },
          ] });
      }
      const total = Number(count_a) + Number(count_b);
      if (state.glyphBuffer === null || state.glyphCapacity < Math.max(1024, total)) {
        let capacity = state.glyphCapacity === 0 ? 1024 : state.glyphCapacity;
        while (capacity < Math.max(1024, total)) capacity *= 2;
        if (state.glyphBuffer !== null) state.glyphBuffer.destroy();
        state.glyphBuffer = state.device.createBuffer({ size: capacity * 32,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        state.glyphCapacity = capacity;
      }
      state.device.queue.writeBuffer(state.glyphBuffer, 0,
        new Uint8Array(HEAPU8.buffer, glyphs_a, Number(count_a) * 32), 0, Number(count_a) * 32);
      if (Number(count_b) > 0) {
        state.device.queue.writeBuffer(state.glyphBuffer, Number(count_a) * 32,
          new Uint8Array(HEAPU8.buffer, glyphs_b, Number(count_b) * 32), 0, Number(count_b) * 32);
      }
      state.device.queue.writeBuffer(state.glyphUniform, 0,
        new Float32Array([cssWidth, cssHeight, 0, 0]));
      // The glyph tint is tokens::fg; the fragment multiplies its alpha by the
      // atlas coverage so the same glyph quads shade exactly like WebGL2.
      state.device.queue.writeBuffer(state.glyphUniform, 16,
        new Float32Array([HEAPF32[(tint >> 2) + 0], HEAPF32[(tint >> 2) + 1],
          HEAPF32[(tint >> 2) + 2], HEAPF32[(tint >> 2) + 3]]));
      pass.setPipeline(state.glyphPipeline);
      pass.setBindGroup(0, state.glyphBindGroup);
      pass.setVertexBuffer(0, state.glyphBuffer);
      pass.draw(6, total);
    }
  }
  pass.end();
  state.device.queue.submit([encoder.finish()]);
  return 1;
  } catch (error) {
    state.status = -1; state.code = 7;
    state.error = String(error && error.message ? error.message : error);
    return 0;
  }
});

bool create(const char* canvas_selector, const float palette[6][3], const float clear[3]) {
  if (canvas_selector == nullptr || canvas_selector[0] == '\0') {
    g_error = "engine_create_webgpu needs a canvas selector";
    return false;
  }
  if (air_webgpu_create_js(canvas_selector, &palette[0][0], clear) == 0) {
    g_error = messageFor(air_webgpu_error_code_js());
    return false;
  }
  g_error = "WebGPU device is still initialising";
  return true;
}

bool resize(int css_width, int css_height, float device_pixel_ratio) {
  if (css_width <= 0 || css_height <= 0) {
    g_error = "WebGPU canvas size must be positive";
    return false;
  }
  if (!(device_pixel_ratio > 0.0F)) {
    g_error = "WebGPU device pixel ratio must be positive";
    return false;
  }
  air_webgpu_resize_js(css_width, css_height, device_pixel_ratio);
  return true;
}

bool frame(const void* instance_bytes, std::size_t instance_count, int css_width, int css_height,
           float device_pixel_ratio, double pan_x, double pan_y, double zoom, bool grid_visible,
           const FrameText* text) {
  const int status = air_webgpu_status_js();
  if (status != 1) {
    g_error = messageFor(status < 0 ? air_webgpu_error_code_js() : 0);
    return false;
  }
  if (instance_count > 50000) {
    g_error = "WebGPU frame exceeds the document's 50,000 instance bound";
    return false;
  }
  float faint[4] = {};
  if (!parseRgba(tokens::faint, faint)) {
    g_error = "generated faint token is not an rgba colour";
    return false;
  }
  if (air_webgpu_frame_js(instance_bytes, static_cast<int>(instance_count), css_width, css_height,
                          device_pixel_ratio, pan_x, pan_y, zoom, grid_visible ? 1 : 0,
                          static_cast<float>(tokens::canvas_grid),
                          static_cast<float>(tokens::border_width), faint[0], faint[1], faint[2],
                          faint[3]) == 0) {
    g_error = messageFor(7);
    return false;
  }
  if (text != nullptr && text->ok &&
      (text->glyphCountA > 0 || text->glyphCountB > 0 || text->chromeCount > 0)) {
    if (air_webgpu_post_frame_js(text->glyphsA, static_cast<int>(text->glyphCountA),
                                 text->glyphsB, static_cast<int>(text->glyphCountB), text->chrome,
                                 static_cast<int>(text->chromeCount), text->atlas,
                                 static_cast<int>(text->atlasWidth),
                                 static_cast<int>(text->atlasHeight), text->atlasReady ? 1 : 0,
                                 text->tint) == 0) {
      g_error = messageFor(7);
      return false;
    }
  }
  return true;
}

void shutdown() {
  air_webgpu_shutdown_js();
  g_error = "WebGPU renderer has not been created";
}

int ready() {
  const int status = air_webgpu_status_js();
  if (status == 1) {
    return 1;
  }
  if (status == 0) {
    g_error = messageFor(0);
    return 0;
  }
  g_error = messageFor(air_webgpu_error_code_js());
  return -1;
}

const char* lastError() { return g_error.c_str(); }

#else  // !defined(__EMSCRIPTEN__)

namespace {
const char* g_error = "WebGPU renderer is only available in the WebAssembly build";
}

bool create(const char*, const float[6][3], const float[3]) {
  g_error = "WebGPU renderer is only available in the WebAssembly build";
  return false;
}

bool resize(int, int, float) { return false; }

bool frame(const void*, std::size_t, int, int, float, double, double, double, bool,
           const FrameText*) {
  g_error = "WebGPU renderer is only available in the WebAssembly build";
  return false;
}

void shutdown() { g_error = "WebGPU renderer is only available in the WebAssembly build"; }

int ready() { return -1; }

const char* lastError() { return g_error; }

#endif

}  // namespace air::engine::webgpu
