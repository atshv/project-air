#pragma once

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "engine/doc.h"
#include "engine/geometry.h"
#include "engine/status.h"

namespace air::engine {

// Uniform-grid spatial index over one document's world-space rectangles. It is
// rebuilt only when the document changes (Document::version), never per frame,
// and it is bound to the document it was built for (Document::instanceId): an
// index for another document with the same version is never accepted.
//
// Incremental mutations keep the index current without an O(n) rebuild:
// updateSlot() re-indexes one added or moved object, removeSlot() drops one
// removed object and syncVersion() follows a draw-order-only mutation. Queries
// reuse the index's own buffers, so they allocate nothing themselves: the caller
// only pays for its output vector.
class SpatialIndex {
 public:
  // Internal performance constant, not a design value: cell size in world pixels.
  static constexpr double kCellSize = 256.0;

  // Rebuilds the grid for the document's identity and current version.
  void rebuild(const Document& document);

  // Re-indexes one live slot after an insert or a geometry change; a non-live
  // slot is only dropped. Falls back to a rebuild when the index belongs to
  // another document or was never built.
  void updateSlot(const Document& document, std::uint32_t slot);

  // Drops one slot after Document::removeObject and follows the new version.
  void removeSlot(const Document& document, std::uint32_t slot);

  // Follows a mutation that cannot change cells (for example updateZ) and keeps
  // the index bound to the document's identity and version.
  void syncVersion(const Document& document);

  // Rebuilds the grid when it is stale for the document. Every incremental ABI
  // mutation calls this before it patches, so a grid left behind by a rejected
  // load or a foreign document is never patched blindly.
  void ensureCurrent(const Document& document);

  // True when the grid was built for this exact document and version.
  bool isCurrent(const Document& document) const;

  // Fills `out` with the live slot indices whose cells intersect `worldBounds`,
  // deduplicated and in document order (ascending slot index). `out` is cleared
  // first and only grows the caller's vector; the index itself allocates nothing.
  // Requires a current index (isCurrent); a non-finite bound is clamped to the
  // grid's edge, exactly like the build-time culling. Returns a Status so a
  // caller can surface a never-built index instead of using stale candidates.
  Status query(const Bounds& worldBounds, std::vector<std::uint32_t>& out) const;

  // Point query: the same contract as query() for a zero-size rectangle.
  Status queryPoint(Point point, std::vector<std::uint32_t>& out) const;

 private:
  void ensureSlotCapacity(std::size_t slotCount);
  void insertSlot(const Document& document, std::uint32_t slot);
  void eraseSlot(std::uint32_t slot);
  void collect(const Bounds& worldBounds, std::vector<std::uint32_t>& out) const;
  std::uint32_t nextGeneration() const;

  std::unordered_map<std::int64_t, std::vector<std::uint32_t>> cells_;
  std::vector<std::uint32_t> oversized_;
  std::vector<Bounds> slotBounds_;
  // Per slot: 0 = not indexed, 1 = in cells_, 2 = in oversized_.
  std::vector<std::uint8_t> slotState_;
  mutable std::vector<std::uint32_t> scratch_;
  mutable std::vector<std::uint32_t> stamps_;
  mutable std::uint32_t generation_{0};
  std::uint64_t documentId_{0};
  std::uint32_t documentVersion_{0};
  bool built_{false};
};

}  // namespace air::engine
