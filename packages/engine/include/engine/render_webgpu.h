#pragma once

// P4-11: WebGPU render pipeline behind the command buffer.
//
// The WebGL2 renderer and the WebGPU renderer consume the same 24-byte
// `air::engine::Instance` records built by `CommandBuffer`; this module only
// uploads those bytes and issues one instanced draw through a small Emscripten JS
// helper (WebGPU is browser-only). C++ owns the frame decision, the document,
// the camera, the command buffer and the token colours; no JS call happens per
// object. Backend selection/fallback (P4-12) and the two-backend comparison
// (P4-13) are separate tasks.

#include <cstddef>

namespace air::engine::webgpu {

// The palette and clear colour are decoded from tokens.h by the caller; the
// module never contains a raw colour. `palette` is 6 x RGB (neutral, tone A..E),
// `clear` is the tokens::canvas colour.
bool create(const char* canvas_selector, const float palette[6][3], const float clear[3]);
bool resize(int css_width, int css_height, float device_pixel_ratio);

// Uploads the current command-buffer bytes into the reused instance GPU buffer and
// issues one instanced draw. `instance_count` records of 24 bytes.
bool frame(const void* instance_bytes, std::size_t instance_count, int css_width,
           int css_height, float device_pixel_ratio);

// 1 = device and pipeline ready, 0 = asynchronous initialisation still running,
// -1 = initialisation failed. The create call never blocks the browser main
// thread; a frame before readiness fails cleanly instead of rendering with a
// partial device.
int ready();

// Human-readable reason of the last failed call (never empty after a failure).
const char* lastError();

}  // namespace air::engine::webgpu
