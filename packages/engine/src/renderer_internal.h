#pragma once

// Internal seam between the WebGL2 object renderer (render_gl.cpp) and the glyph
// pass (text_gl.cpp). Only the WebAssembly build uses it; it is not a public
// header.

#if defined(__EMSCRIPTEN__)

#include "engine/render_webgpu.h"
#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/render.h"
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
  // P6-15: the depth bands of the command buffer built for this frame. Their
  // rank ranges map the bound runs and header chrome onto the object pass, so
  // the text of a band draws between that band and the next one.
  const DrawBand* bands{nullptr};
  std::size_t bandCount{0};
};

// Implemented in render_gl.cpp.
FrameView frameView();
void setLastError(const char* reason);
bool parseRgbaToken(const char* value, float* rgba);

// P4-13: WebGPU text/chrome data (implemented in text_gl.cpp).
bool createTextDataOnly();
bool webgpuTextFrame(webgpu::FrameText& out);

// Implemented in text_gl.cpp: builds the glyph program once per context, and
// draws the glyph runs after the object pass (blend state is set and restored
// inside). Both report failures through setLastError.
bool createTextPass();
bool drawTextPass();

// P6-15 depth-ordered text. `textBandsPresent` tells the renderer whether bound
// text exists, i.e. whether the object pass must be split into depth bands.
// With bands the renderer calls prepareTextPass() after building the command
// buffer, then drawTextBand(i) after each band's objects, then drawTextTail().
bool textBandsPresent();
bool prepareTextPass();
bool drawTextBand(std::size_t bandIndex);
bool drawTextTail();

}  // namespace air::engine::detail

#endif  // defined(__EMSCRIPTEN__)
