#include "engine/spatial.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

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

struct CellRange {
  std::int32_t minX{0};
  std::int32_t maxX{0};
  std::int32_t minY{0};
  std::int32_t maxY{0};
};

CellRange cellRange(const Bounds& bounds) {
  return {cellCoordinate(bounds.x), cellCoordinate(bounds.right()), cellCoordinate(bounds.y),
          cellCoordinate(bounds.bottom())};
}

bool isOversized(const CellRange& range) {
  return static_cast<std::int64_t>(range.maxX) - range.minX > kMaxCellsPerAxis ||
         static_cast<std::int64_t>(range.maxY) - range.minY > kMaxCellsPerAxis;
}

}  // namespace

void SpatialIndex::rebuild(const Document& document) {
  cells_.clear();
  oversized_.clear();
  const std::size_t slotCount = document.slotCount();
  if (slotBounds_.capacity() < Document::kMaxRectangles) {
    slotBounds_.reserve(Document::kMaxRectangles);
  }
  if (slotState_.capacity() < Document::kMaxRectangles) {
    slotState_.reserve(Document::kMaxRectangles);
  }
  if (stamps_.capacity() < Document::kMaxRectangles) {
    stamps_.reserve(Document::kMaxRectangles);
  }
  if (scratch_.capacity() < Document::kMaxRectangles) {
    scratch_.reserve(Document::kMaxRectangles);
  }
  slotBounds_.assign(slotCount, Bounds{});
  slotState_.assign(slotCount, 0);
  stamps_.assign(slotCount, 0);
  scratch_.clear();
  generation_ = 0;
  cells_.reserve(slotCount);

  for (std::uint32_t slot = 0; slot < slotCount; ++slot) {
    if (document.isLive(slot)) {
      insertSlot(document, slot);
    }
  }

  documentId_ = document.instanceId();
  documentVersion_ = document.version();
  built_ = true;
}

void SpatialIndex::updateSlot(const Document& document, std::uint32_t slot) {
  if (!built_ || documentId_ != document.instanceId() || slot >= document.slotCount()) {
    // A foreign or failed index cannot be patched; rebuild it instead of mixing
    // two documents' cells.
    rebuild(document);
    return;
  }
  ensureSlotCapacity(document.slotCount());
  eraseSlot(slot);
  if (document.isLive(slot)) {
    insertSlot(document, slot);
  }
  documentVersion_ = document.version();
}

void SpatialIndex::removeSlot(const Document& document, std::uint32_t slot) {
  if (!built_ || documentId_ != document.instanceId() || slot >= document.slotCount()) {
    rebuild(document);
    return;
  }
  ensureSlotCapacity(document.slotCount());
  eraseSlot(slot);
  documentVersion_ = document.version();
}

void SpatialIndex::syncVersion(const Document& document) {
  if (!built_ || documentId_ != document.instanceId()) {
    rebuild(document);
    return;
  }
  documentVersion_ = document.version();
}

bool SpatialIndex::isCurrent(const Document& document) const {
  return built_ && documentId_ == document.instanceId() &&
         documentVersion_ == document.version();
}

void SpatialIndex::ensureCurrent(const Document& document) {
  if (!isCurrent(document)) {
    rebuild(document);
  }
}

Status SpatialIndex::query(const Bounds& worldBounds, std::vector<std::uint32_t>& out) const {
  out.clear();
  if (!built_) {
    return Status::failure("spatial index is not built; rebuild it for this document");
  }
  collect(worldBounds, out);
  return Status::success();
}

Status SpatialIndex::queryPoint(Point point, std::vector<std::uint32_t>& out) const {
  return query(Bounds{point.x, point.y, 0.0, 0.0}, out);
}

void SpatialIndex::ensureSlotCapacity(std::size_t slotCount) {
  if (slotBounds_.size() < slotCount) {
    slotBounds_.resize(slotCount);
    slotState_.resize(slotCount, 0);
    stamps_.resize(slotCount, 0);
  }
  if (scratch_.capacity() < slotCount) {
    scratch_.reserve(slotCount);
  }
}

void SpatialIndex::insertSlot(const Document& document, std::uint32_t slot) {
  const Bounds bounds = document.rectangles()[slot].bounds();
  slotBounds_[slot] = bounds;
  const CellRange range = cellRange(bounds);
  if (isOversized(range)) {
    slotState_[slot] = 2;
    oversized_.push_back(slot);
    return;
  }
  slotState_[slot] = 1;
  for (std::int32_t cellX = range.minX; cellX <= range.maxX; ++cellX) {
    for (std::int32_t cellY = range.minY; cellY <= range.maxY; ++cellY) {
      cells_[cellKey(cellX, cellY)].push_back(slot);
    }
  }
}

void SpatialIndex::eraseSlot(std::uint32_t slot) {
  if (slot >= slotState_.size()) {
    return;
  }
  const std::uint8_t state = slotState_[slot];
  if (state == 1) {
    const CellRange range = cellRange(slotBounds_[slot]);
    for (std::int32_t cellX = range.minX; cellX <= range.maxX; ++cellX) {
      for (std::int32_t cellY = range.minY; cellY <= range.maxY; ++cellY) {
        const auto found = cells_.find(cellKey(cellX, cellY));
        if (found == cells_.end()) {
          continue;
        }
        std::vector<std::uint32_t>& bucket = found->second;
        const auto position = std::find(bucket.begin(), bucket.end(), slot);
        if (position == bucket.end()) {
          continue;
        }
        bucket.erase(position);
        if (bucket.empty()) {
          cells_.erase(found);
        }
      }
    }
  } else if (state == 2) {
    oversized_.erase(std::remove(oversized_.begin(), oversized_.end(), slot), oversized_.end());
  }
  slotState_[slot] = 0;
  slotBounds_[slot] = Bounds{};
}

void SpatialIndex::collect(const Bounds& worldBounds, std::vector<std::uint32_t>& out) const {
  scratch_.clear();
  const std::uint32_t generation = nextGeneration();
  const auto consider = [this, generation](std::uint32_t slot) {
    // Defence in depth: a foreign index must not write outside its stamp table.
    if (slot >= stamps_.size()) {
      return;
    }
    if (stamps_[slot] == generation) {
      return;
    }
    stamps_[slot] = generation;
    scratch_.push_back(slot);
  };

  const CellRange range = cellRange(worldBounds);
  for (std::int32_t cellX = range.minX; cellX <= range.maxX; ++cellX) {
    for (std::int32_t cellY = range.minY; cellY <= range.maxY; ++cellY) {
      const auto found = cells_.find(cellKey(cellX, cellY));
      if (found == cells_.end()) {
        continue;
      }
      for (const std::uint32_t slot : found->second) {
        consider(slot);
      }
    }
  }
  for (const std::uint32_t slot : oversized_) {
    consider(slot);
  }

  // Cell order depends on the query rectangle; the document order is the slot
  // order, so the sorted range is stable across queries and easy to consume.
  std::sort(scratch_.begin(), scratch_.end());
  out.insert(out.end(), scratch_.begin(), scratch_.end());
}

std::uint32_t SpatialIndex::nextGeneration() const {
  if (generation_ == std::numeric_limits<std::uint32_t>::max()) {
    std::fill(stamps_.begin(), stamps_.end(), 0U);
    generation_ = 1;
  } else {
    ++generation_;
  }
  return generation_;
}

}  // namespace air::engine
