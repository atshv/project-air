#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/spatial.h"
#include "engine/status.h"

namespace air::engine {

// One instanced rectangle quad in the render command buffer. The layout is stable
// and is reused unchanged by the WebGL2 renderer (P2-03):
//   x, y, width, height  screen-space pixels (top-left origin)
//   tone                 doc::Tone, resolved to a tokens.h colour via toneColor()
//   layer                design-rules §8 layer number
struct Instance {
  float x{0.0F};
  float y{0.0F};
  float width{0.0F};
  float height{0.0F};
  std::uint32_t tone{0};
  std::uint32_t layer{0};
};
static_assert(sizeof(Instance) == 24, "instance layout is the WebGL2 seam");

// Returns the generated tokens.h colour for a tone; P2-03 parses this string.
// `toneColor(Tone::neutral)` is a provisional spike mapping to tokens::card; the
// contract carries no tone, so P2-03 must not treat it as final design.
const char* toneColor(Tone tone);

// Deterministic render command buffer: reserved once for the maximum document
// size, then clear() + rebuild without growth. Two builds from identical
// documents, camera and viewport produce byte-identical records.
class CommandBuffer {
 public:
  CommandBuffer();

  // Reserves capacity for `maxInstances` records; the default covers the maximum
  // document size (50,000 rectangles) so a frame never allocates.
  void reserve(std::size_t maxInstances);

  void clear();
  std::size_t size() const { return instances_.size(); }
  bool empty() const { return instances_.empty(); }
  const std::vector<Instance>& instances() const { return instances_; }

  // Raw record bytes for determinism checks (nullptr when empty).
  const std::uint8_t* bytes() const;
  std::size_t byteSize() const;

  // Builds the screen-space quads of every visible rectangle in stable draw
  // order. Fails with a Status when the spatial index is stale or belongs to
  // another document, the viewport is not positive and finite, or a candidate
  // index is out of range (defence in depth); the buffer is then left empty.
  Status build(const Document& document, const Camera& camera, double viewportWidth,
               double viewportHeight, const SpatialIndex& spatial);

 private:
  std::vector<Instance> instances_;
  std::vector<std::uint32_t> candidates_;
};

}  // namespace air::engine
