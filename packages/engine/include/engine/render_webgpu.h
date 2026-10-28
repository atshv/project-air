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
#include <cstdint>

#include "engine/text.h"

namespace air::engine::webgpu {

// P4-13: one frame of the glyph and chrome passes, built by the shared text
// core and consumed by the WebGPU glyph/chrome pipelines. Pointers reference the
// text pass's frame buffers and stay valid until the next frame.
struct FrameText {
  bool ok{false};
  const GlyphInstance* glyphsA{nullptr};
  std::size_t glyphCountA{0};
  const GlyphInstance* glyphsB{nullptr};
  std::size_t glyphCountB{0};
  const void* chrome{nullptr};  // ChromeGpuInstance: rect 4 floats + rgba 4 floats, stride 32
  std::size_t chromeCount{0};
  const std::uint8_t* atlas{nullptr};
  std::uint32_t atlasWidth{0};
  std::uint32_t atlasHeight{0};
  bool atlasReady{false};
  float tint[4] = {};
};

// The palette and clear colour are decoded from tokens.h by the caller; the
// module never contains a raw colour. `palette` is 6 x RGB (neutral, tone A..E),
// `clear` is the tokens::canvas colour.
bool create(const char* canvas_selector, const float palette[6][3], const float clear[3]);
bool resize(int css_width, int css_height, float device_pixel_ratio);

// Uploads the current command-buffer bytes into the reused instance GPU buffer and
// issues one instanced draw. `instance_count` records of 24 bytes.
bool frame(const void* instance_bytes, std::size_t instance_count, int css_width,
           int css_height, float device_pixel_ratio, double pan_x, double pan_y, double zoom,
           bool grid_visible, const FrameText* text);

// 1 = device and pipeline ready, 0 = asynchronous initialisation still running,
// -1 = initialisation failed. The create call never blocks the browser main
// thread; a frame before readiness fails cleanly instead of rendering with a
// partial device.
int ready();

// Releases the browser WebGPU device and helper state (P4-12 fallback after a
// failed readiness); a later WebGL2 create in the same module is unaffected.
void shutdown();

// Human-readable reason of the last failed call (never empty after a failure).
const char* lastError();

}  // namespace air::engine::webgpu
