// P4-11: WebGPU render pipeline behind the command buffer.
//
// Under Emscripten the C++ module calls a small EM_JS helper; the helper owns the
// browser WebGPU objects (adapter, device, context, pipeline, GPUBuffers) while
// C++ owns the frame decision and the 24-byte instance bytes. The WGSL shader
// consumes the same `Instance` layout as the WebGL2 renderer: x, y, width, height
// (screen-space CSS px, top-left origin), tone (uint), layer (uint). One
// instanced draw per frame; palette and clear colour arrive from tokens.h through
// C++, so there is no second colour table and no per-object JS call.
//
// Native builds have no browser API: every entry point fails cleanly (P4-11 A2).

#include "engine/render_webgpu.h"

#include <cstddef>
#include <string>

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
}  // namespace

// Starts the asynchronous device/pipeline creation and returns immediately. A
// frame before readiness fails cleanly through ready()/frame(); no partial device
// ever draws. The palette (6 x RGB) and the clear colour are copied out of the
// C++ heap once.
EM_JS(int, air_webgpu_create_js, (const char* selector, const float* palette, const float* clear), {
  const state = globalThis.__airWebgpu = {
    status: 0, code: 0, error: "", adapterInfo: null,
    device: null, context: null, format: null, pipeline: null,
    uniformBuffer: null, paletteBuffer: null, bindGroup: null,
    instanceBuffer: null, capacity: 0, canvas: null, cssWidth: 0, cssHeight: 0, dpr: 1,
    configured: "", palette: [], clear: [],
  };
  for (let i = 0; i < 18; i += 1) state.palette.push(HEAPF32[(palette >> 2) + i]);
  for (let i = 0; i < 3; i += 1) state.clear.push(HEAPF32[(clear >> 2) + i]);
  if (typeof navigator === "undefined" || navigator.gpu === undefined) {
    state.status = -1; state.code = 1; state.error = "navigator.gpu missing"; return 0;
  }
  const canvas = document.querySelector(UTF8ToString(selector));
  if (canvas === null) {
    state.status = -1; state.code = 2; state.error = "canvas not found"; return 0;
  }
  state.canvas = canvas;
  const wgsl = [
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
        state.error = String(event.error && event.error.message ? event.error.message : event.error);
      });
      const context = canvas.getContext("webgpu");
      if (context === null) { state.status = -1; state.code = 5; return; }
      state.context = context;
      state.format = navigator.gpu.getPreferredCanvasFormat();
      const module = device.createShaderModule({ code: wgsl });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === "error");
      if (errors.length > 0) {
        state.status = -1; state.code = 6;
        state.error = errors.map((message) => message.message).join("; ");
        return;
      }
      state.pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vertex_main", buffers: [{
          arrayStride: 24, stepMode: "instance", attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "uint32" },
            { shaderLocation: 2, offset: 20, format: "uint32" }] }] },
        fragment: { module, entryPoint: "fragment_main", targets: [{ format: state.format }] },
        primitive: { topology: "triangle-list" },
      });
      state.uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const paletteData = new Float32Array(24);
      for (let i = 0; i < 6; i += 1) {
        paletteData[i * 4 + 0] = state.palette[i * 3 + 0];
        paletteData[i * 4 + 1] = state.palette[i * 3 + 1];
        paletteData[i * 4 + 2] = state.palette[i * 3 + 2];
        paletteData[i * 4 + 3] = 1.0;
      }
      state.paletteBuffer = device.createBuffer({ size: paletteData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(state.paletteBuffer, 0, paletteData);
      state.status = 1;
    } catch (error) {
      state.status = -1;
      state.code = state.pipeline === null ? 6 : 4;
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

EM_JS(int, air_webgpu_frame_js, (const void* bytes, int count, int css_width, int css_height, float dpr), {
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
      state.instanceBuffer = state.device.createBuffer({ size: capacity * 24, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      state.capacity = capacity;
      state.bindGroup = null;
    }
    state.device.queue.writeBuffer(state.instanceBuffer, 0, new Uint8Array(HEAPU8.buffer, bytes, byteCount), 0, byteCount);
  }
  const canvas = state.canvas;
  const width = Math.max(1, Math.round(Number(css_width) * Number(dpr)));
  const height = Math.max(1, Math.round(Number(css_height) * Number(dpr)));
  if (canvas !== null && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width; canvas.height = height; state.bindGroup = null;
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
  const encoder = state.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: state.context.getCurrentTexture().createView(),
      clearValue: { r: state.clear[0], g: state.clear[1], b: state.clear[2], a: 1.0 },
      loadOp: "clear", storeOp: "store",
    }],
  });
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
           float device_pixel_ratio) {
  const int status = air_webgpu_status_js();
  if (status != 1) {
    g_error = messageFor(status < 0 ? air_webgpu_error_code_js() : 0);
    return false;
  }
  if (instance_count > 50000) {
    g_error = "WebGPU frame exceeds the document's 50,000 instance bound";
    return false;
  }
  if (air_webgpu_frame_js(instance_bytes, static_cast<int>(instance_count), css_width, css_height,
                          device_pixel_ratio) == 0) {
    g_error = messageFor(7);
    return false;
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

bool frame(const void*, std::size_t, int, int, float) {
  g_error = "WebGPU renderer is only available in the WebAssembly build";
  return false;
}

int ready() { return -1; }

void shutdown() { g_error = "WebGPU renderer is only available in the WebAssembly build"; }

const char* lastError() { return g_error; }

#endif

}  // namespace air::engine::webgpu
