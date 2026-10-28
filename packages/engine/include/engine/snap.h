#pragma once

// L07 (P4-15) snapping core: pure, deterministic, allocation-free in the hot path.
//
// From the dragged rectangle, the document, the spatial index, the camera and the
// viewport it returns the snapped world position plus up to three guide lines, or
// the grid position when nothing is in tolerance. Candidates are the
// left/centre/right and top/middle/bottom lines of live, visible neighbours and
// zones, never the dragged object itself. The tolerance is `tokens::snap_tolerance`
// screen px, converted to world px with the camera zoom, so 6 px of the pointer
// remains 6 px at every zoom. A line match beats `Camera::snapToGrid` per axis;
// without a match the 16 px grid applies; `free` (Shift) bypasses both.
//
// The function is deliberately called only while a drag is in progress: nothing
// runs during pan, zoom or an idle frame. Guides are presentation state (the
// chrome pass draws them); they never enter the document, an operation payload or
// the command-buffer instance counts.

#include <cstddef>
#include <cstdint>
#include <vector>

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/spatial.h"
#include "engine/status.h"

namespace air::engine {

// Line orientation: a vertical guide is a world x, a horizontal guide a world y.
enum class SnapOrientation : std::uint8_t { vertical = 0, horizontal = 1 };

// One guide line in world px, spanning the dragged and the matched element plus
// the token 16 px extension on both ends (L07: "continuous across both elements
// + 16 px").
struct SnapGuide {
  SnapOrientation orientation{SnapOrientation::vertical};
  double position{0.0};  // world x for vertical, world y for horizontal
  double start{0.0};     // world start of the span
  double end{0.0};       // world end of the span
};
static_assert(sizeof(SnapGuide) == 32, "guide record layout is the chrome-pass seam");

// L07 "no lines beyond 3 simultaneous hits".
inline constexpr std::size_t kMaxSnapGuides = 3;
// Documented hot-path limit: more candidates than this (a dense 50,000-object
// board) are still visited in document order, but the scratch vector is reserved
// once and the loop never allocates.
inline constexpr std::size_t kSnapScratchReserve = 256;

// Reusable candidate buffer; the caller owns it, so a drag frame allocates
// nothing after the first reserve (L07 "no hot-path allocation").
struct SnapScratch {
  std::vector<std::uint32_t> candidates;

  void reserve(std::size_t capacity) { candidates.reserve(capacity); }
};

// Snapped world position of one dragged object and the guides to draw.
struct SnapResult {
  double x{0.0};
  double y{0.0};
  bool snappedX{false};  // a line match (not the grid) decided x
  bool snappedY{false};  // a line match (not the grid) decided y
  std::size_t guideCount{0};
  SnapGuide guides[kMaxSnapGuides]{};
};

// Snaps the world top-left (x, y) of the live object at `draggedSlot`.
//
// - `viewportWidth`/`viewportHeight` are CSS px; candidates outside the visible
//   world bounds are ignored.
// - `free` is the Shift state: the position is returned unchanged, no guide is
//   produced, and the grid is not applied.
// - Deterministic: candidates are visited in document slot order and the line
//   kinds in a fixed left/centre/right (top/middle/bottom) order; equal distances
//   keep the first match. Repeating a call with the same state returns a
//   byte-identical result.
// - Fails for an unknown or removed dragged slot, non-finite coordinates, a
//   non-positive viewport or a stale spatial index, leaving `out` untouched.
Status snapPosition(const Document& document, const SpatialIndex& spatial, const Camera& camera,
                    std::uint32_t draggedSlot, double viewportWidth, double viewportHeight,
                    double x, double y, bool free, SnapScratch& scratch, SnapResult& out);

}  // namespace air::engine
