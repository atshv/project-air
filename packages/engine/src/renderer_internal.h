#pragma once

// Internal seam between the WebGL2 object renderer (render_gl.cpp) and the glyph
// pass (text_gl.cpp). Only the WebAssembly build uses it; it is not a public
// header.

#if defined(__EMSCRIPTEN__)

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/snap.h"
#include "engine/spatial.h"

namespace air::engine::detail {

// Renderer state the glyph/chrome pass reads; created == false before
// engine_create. The document and its spatial index point into the renderer's
// working copy: the P4-10 binding needs them to cull presentation text with the
// object. `guides` is the L07 snap state of the current drag (world lines); the
// chrome pass draws them as 1 px accent quads and they never enter the command
// buffer.
struct FrameView {
  bool created{false};
  const Camera* camera{nullptr};
  int cssWidth{0};
  int cssHeight{0};
  const Document* document{nullptr};
  const SpatialIndex* spatial{nullptr};
  const SnapGuide* guides{nullptr};
  std::size_t guideCount{0};
};

// Implemented in render_gl.cpp.
FrameView frameView();
void setLastError(const char* reason);
bool parseRgbaToken(const char* value, float* rgba);

// Implemented in text_gl.cpp: builds the glyph program once per context, and
// draws the glyph runs after the object pass (blend state is set and restored
// inside). Both report failures through setLastError.
bool createTextPass();
bool drawTextPass();

}  // namespace air::engine::detail

#endif  // defined(__EMSCRIPTEN__)
