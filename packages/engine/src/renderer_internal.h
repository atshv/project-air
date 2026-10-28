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
  // L10 (P4-16) selection chrome: the selected live slots (framed with 1 px
  // accent) and the live rubber band (accent-soft fill, accent border) in world
  // px. Presentation state only; never command-buffer instances.
  const std::uint32_t* selectionSlots{nullptr};
  std::size_t selectionCount{0};
  const Bounds* band{nullptr};
  // L08 (P4-27) zone drop highlight: the world bounds of the zone to outline in
  // tokens::accent_line for one second after a successful drop. Presentation
  // state only; never an instance of the command buffer.
  const Bounds* highlight{nullptr};
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
