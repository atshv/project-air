#include "engine/spatial.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace air::engine {
namespace {

// Bounds of the clamped cell coordinate; keeps very large world coordinates from
// overflowing the int32 cell space. Collapsing far-away coordinates onto the same
// cell only over-includes candidates, which the command buffer filters exactly.
constexpr double kMinCellCoordinate = -1048576.0;
constexpr double kMaxCellCoordinate = 1048576.0;

// A rectangle spanning more cells than this per axis is kept out of the grid and
// always offered as a candidate, so one huge rectangle cannot inflate rebuild.
constexpr std::int64_t kMaxCellsPerAxis = 64;

std::int32_t cellCoordinate(double world) {
  // Defence in depth: a non-finite coordinate must never reach the int32 cast
  // (floor(NaN) and casting an out-of-range double are undefined behaviour).
  if (!std::isfinite(world)) {
    return 0;
  }
  const double cell = std::floor(world / SpatialIndex::kCellSize);
  return static_cast<std::int32_t>(std::clamp(cell, kMinCellCoordinate, kMaxCellCoordinate));
}

std::int64_t cellKey(std::int32_t x, std::int32_t y) {
  return (static_cast<std::int64_t>(x) << 32U) | static_cast<std::uint32_t>(y);
}

}  // namespace

void SpatialIndex::rebuild(const Document& document) {
  cells_.clear();
  oversized_.clear();
  const std::vector<Rectangle>& rectangles = document.rectangles();
  cells_.reserve(rectangles.size());

  for (std::size_t index = 0; index < rectangles.size(); ++index) {
    const Bounds bounds = rectangles[index].bounds();
    const std::int32_t minX = cellCoordinate(bounds.x);
    const std::int32_t maxX = cellCoordinate(bounds.right());
    const std::int32_t minY = cellCoordinate(bounds.y);
    const std::int32_t maxY = cellCoordinate(bounds.bottom());
    if (static_cast<std::int64_t>(maxX) - minX > kMaxCellsPerAxis ||
        static_cast<std::int64_t>(maxY) - minY > kMaxCellsPerAxis) {
      oversized_.push_back(static_cast<std::uint32_t>(index));
      continue;
    }
    for (std::int32_t cellX = minX; cellX <= maxX; ++cellX) {
      for (std::int32_t cellY = minY; cellY <= maxY; ++cellY) {
        cells_[cellKey(cellX, cellY)].push_back(static_cast<std::uint32_t>(index));
      }
    }
  }

  documentId_ = document.instanceId();
  documentVersion_ = document.version();
  built_ = true;
}

bool SpatialIndex::isCurrent(const Document& document) const {
  return built_ && documentId_ == document.instanceId() &&
         documentVersion_ == document.version();
}

void SpatialIndex::query(const Bounds& worldBounds, std::vector<std::uint32_t>& out) const {
  const std::int32_t minX = cellCoordinate(worldBounds.x);
  const std::int32_t maxX = cellCoordinate(worldBounds.right());
  const std::int32_t minY = cellCoordinate(worldBounds.y);
  const std::int32_t maxY = cellCoordinate(worldBounds.bottom());

  for (std::int32_t cellX = minX; cellX <= maxX; ++cellX) {
    for (std::int32_t cellY = minY; cellY <= maxY; ++cellY) {
      const auto found = cells_.find(cellKey(cellX, cellY));
      if (found != cells_.end()) {
        out.insert(out.end(), found->second.begin(), found->second.end());
      }
    }
  }
  out.insert(out.end(), oversized_.begin(), oversized_.end());
}

}  // namespace air::engine
