#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
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

// Result of a command-buffer hit test: the empty result has found == false,
// slot == kNoObject and objectId == kInvalidObjectId.
inline constexpr std::uint32_t kNoObject = std::numeric_limits<std::uint32_t>::max();

struct HitResult {
  bool found{false};
  std::uint32_t slot{kNoObject};
  ObjectId objectId{kInvalidObjectId};
};

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

  // Builds the screen-space quads of every visible live rectangle in stable draw
  // order. Fails with a Status when the spatial index is stale or belongs to
  // another document, the viewport is not positive and finite, or a candidate
  // index is out of range (defence in depth); the buffer is then left empty.
  Status build(const Document& document, const Camera& camera, double viewportWidth,
               double viewportHeight, const SpatialIndex& spatial);

  // Hit test on the command-buffer level: maps the screen point through the
  // camera, asks the spatial index for its candidates and returns the topmost
  // live object in draw order (highest layer, then greatest z, then latest
  // insertion order), or the empty result when no object contains the point.
  // A point exactly on an edge or corner hits every rectangle that includes it;
  // the draw-order rule picks one deterministically. Fails with a Status for a
  // non-finite point or a viewport that is not positive and finite, and when the
  // spatial index is stale or belongs to another document.
  Status hitTest(const Document& document, const Camera& camera, const SpatialIndex& spatial,
                 double viewportWidth, double viewportHeight, Point screenPoint, HitResult& out);

 private:
  std::vector<Instance> instances_;
  std::vector<std::uint32_t> candidates_;
};

}  // namespace air::engine
