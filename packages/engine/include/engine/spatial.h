#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

#include "engine/doc.h"
#include "engine/geometry.h"

namespace air::engine {

// Uniform-grid spatial index over one document's world-space rectangles. It is
// rebuilt only when the document changes (Document::version), never per frame,
// and it is bound to the document it was built for (Document::instanceId): an
// index for another document with the same version is never accepted.
class SpatialIndex {
 public:
  // Internal performance constant, not a design value: cell size in world pixels.
  static constexpr double kCellSize = 256.0;

  // Rebuilds the grid for the document's identity and current version.
  void rebuild(const Document& document);

  // True when the grid was built for this exact document and version.
  bool isCurrent(const Document& document) const;

  // Appends the indices of rectangles whose cells intersect `worldBounds` to
  // `out`. The result may contain duplicates (a rectangle spans several cells)
  // and rectangles that only touch a cell; the command buffer filters and orders
  // them exactly. Requires a current index.
  void query(const Bounds& worldBounds, std::vector<std::uint32_t>& out) const;

 private:
  std::unordered_map<std::int64_t, std::vector<std::uint32_t>> cells_;
  std::vector<std::uint32_t> oversized_;
  std::uint64_t documentId_{0};
  std::uint32_t documentVersion_{0};
  bool built_{false};
};

}  // namespace air::engine
