#include "engine/snap.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

#include "tokens.h"

namespace air::engine {
namespace {

// Floating-point guard for "the same world line". Document geometry is stored in
// doubles, so two edges that coincide by construction compare exactly; the small
// guard keeps a snapped coordinate that was rebuilt from a delta stable.
constexpr double kSameLineEpsilon = 1e-6;

// Three line kinds per axis: left/centre/right or top/middle/bottom.
constexpr int kLineKindCount = 3;

double lineX(const Rectangle& rectangle, int kind) {
  switch (kind) {
    case 0:
      return rectangle.x;
    case 1:
      return rectangle.x + rectangle.width / 2.0;
    default:
      return rectangle.x + rectangle.width;
  }
}

double lineY(const Rectangle& rectangle, int kind) {
  switch (kind) {
    case 0:
      return rectangle.y;
    case 1:
      return rectangle.y + rectangle.height / 2.0;
    default:
      return rectangle.y + rectangle.height;
  }
}

// Offset of one line kind from the rectangle's top-left, used to test which
// dragged lines coincide after the snap (the extra guides of the same match).
double lineOffsetX(const Rectangle& rectangle, int kind) {
  switch (kind) {
    case 0:
      return 0.0;
    case 1:
      return rectangle.width / 2.0;
    default:
      return rectangle.width;
  }
}

double lineOffsetY(const Rectangle& rectangle, int kind) {
  switch (kind) {
    case 0:
      return 0.0;
    case 1:
      return rectangle.height / 2.0;
    default:
      return rectangle.height;
  }
}

struct AxisMatch {
  bool found{false};
  double distance{0.0};
  std::uint32_t slot{0};
  int candidateLine{0};
  int draggedLine{0};
};

// First match wins on an equal distance (candidates are visited in document slot
// order and line kinds in a fixed order), so the result is deterministic.
void considerAxis(AxisMatch& best, double candidateLine, double draggedLine, double tolerance,
                  std::uint32_t slot, int candidateKind, int draggedKind) {
  const double distance = std::fabs(candidateLine - draggedLine);
  if (distance > tolerance + 1e-9) {
    return;
  }
  if (best.found && distance >= best.distance) {
    return;
  }
  best.found = true;
  best.distance = distance;
  best.slot = slot;
  best.candidateLine = candidateKind;
  best.draggedLine = draggedKind;
}

}  // namespace

Status snapPosition(const Document& document, const SpatialIndex& spatial, const Camera& camera,
                    std::uint32_t draggedSlot, double viewportWidth, double viewportHeight,
                    double x, double y, bool free, SnapScratch& scratch, SnapResult& out) {
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(viewportWidth) ||
      !std::isfinite(viewportHeight) || viewportWidth <= 0.0 || viewportHeight <= 0.0) {
    return Status::failure("snap needs finite coordinates and a positive viewport");
  }
  if (draggedSlot >= document.slotCount() || !document.isLive(draggedSlot)) {
    return Status::failure("the dragged object is not a live document slot");
  }
  if (!spatial.isCurrent(document)) {
    return Status::failure("spatial index is stale for the document");
  }
  const double zoom = camera.zoom();
  if (!std::isfinite(zoom) || zoom <= 0.0) {
    return Status::failure("snap needs a positive, finite camera zoom");
  }

  const Rectangle& dragged = document.rectangles()[draggedSlot];
  SnapResult result;
  result.x = x;
  result.y = y;
  if (free) {
    // Shift: free positioning, no grid and no guides.
    out = result;
    return Status::success();
  }

  const Bounds visible = camera.visibleWorldBounds(viewportWidth, viewportHeight);
  if (!std::isfinite(visible.x) || !std::isfinite(visible.y) || !std::isfinite(visible.width) ||
      !std::isfinite(visible.height)) {
    return Status::failure("visible world bounds must be finite");
  }

  // The tolerance is a screen value: world = tokens::snap_tolerance / zoom, so
  // 6 px of pointer travel stays 6 px at every zoom level.
  const double tolerance = tokens::snap_tolerance / zoom;
  const Rectangle proposed{x, y, dragged.width, dragged.height, dragged.z, dragged.layer,
                           dragged.tone, dragged.insertionOrder, dragged.id, true};

  // A line candidate only has to be within the tolerance on its own axis: a
  // neighbour far above or below still contributes a vertical snap line. The
  // candidate set is therefore every live object visible in the viewport; the
  // exact distance filter below decides each axis.
  scratch.candidates.clear();
  const Status queryStatus = spatial.query(visible, scratch.candidates);
  if (!queryStatus) {
    return queryStatus;
  }

  AxisMatch bestX;
  AxisMatch bestY;
  for (const std::uint32_t slot : scratch.candidates) {
    if (slot == draggedSlot) {
      continue;  // never snap an object to its own edges
    }
    if (slot >= document.rectangles().size()) {
      continue;  // defence in depth: a stale candidate is never dereferenced
    }
    const Rectangle& candidate = document.rectangles()[slot];
    if (!candidate.live) {
      continue;
    }
    if (!candidate.bounds().intersects(visible)) {
      continue;  // the grid cell intersects, the visible exact bounds do not
    }
    for (int candidateKind = 0; candidateKind < kLineKindCount; ++candidateKind) {
      const double candidateLineX = lineX(candidate, candidateKind);
      const double candidateLineY = lineY(candidate, candidateKind);
      for (int draggedKind = 0; draggedKind < kLineKindCount; ++draggedKind) {
        considerAxis(bestX, candidateLineX, lineX(proposed, draggedKind), tolerance, slot,
                     candidateKind, draggedKind);
        considerAxis(bestY, candidateLineY, lineY(proposed, draggedKind), tolerance, slot,
                     candidateKind, draggedKind);
      }
    }
  }

  // One decision point per axis: a line match wins; the grid only applies when no
  // line matched (a grid snap after a match would silently drop the guide).
  result.x = bestX.found ? x + (lineX(document.rectangles()[bestX.slot], bestX.candidateLine) -
                               lineX(proposed, bestX.draggedLine))
                         : Camera::snapToGrid(x);
  result.y = bestY.found ? y + (lineY(document.rectangles()[bestY.slot], bestY.candidateLine) -
                               lineY(proposed, bestY.draggedLine))
                         : Camera::snapToGrid(y);
  result.snappedX = bestX.found;
  result.snappedY = bestY.found;

  // Guides: the matched line first, then the other lines of the same neighbour
  // that coincide with a dragged line after the snap (a same-width neighbour
  // aligns its left, centre and right edges at once). Vertical guides come before
  // horizontal ones, line kinds in their fixed order, and the total is capped at
  // three (L07 "no lines beyond 3").
  const Rectangle snappedDragged{result.x, result.y, dragged.width, dragged.height, dragged.z,
                                 dragged.layer, dragged.tone, dragged.insertionOrder, dragged.id,
                                 true};
  std::size_t guideCount = 0;
  const auto addGuide = [&](SnapOrientation orientation, double position, double start,
                            double end) {
    if (guideCount >= kMaxSnapGuides || !(end > start)) {
      return;
    }
    for (std::size_t index = 0; index < guideCount; ++index) {
      if (result.guides[index].orientation == orientation &&
          std::fabs(result.guides[index].position - position) <= kSameLineEpsilon) {
        return;  // the same world line is already guided
      }
    }
    SnapGuide guide;
    guide.orientation = orientation;
    guide.position = position;
    guide.start = start;
    guide.end = end;
    result.guides[guideCount] = guide;
    guideCount += 1;
  };

  if (bestX.found) {
    const Rectangle& candidate = document.rectangles()[bestX.slot];
    const double start = std::min(snappedDragged.y, candidate.y) - tokens::space_16;
    const double end = std::max(snappedDragged.y + snappedDragged.height,
                                candidate.y + candidate.height) +
                       tokens::space_16;
    for (int candidateKind = 0; candidateKind < kLineKindCount; ++candidateKind) {
      const double candidateLine = lineX(candidate, candidateKind);
      for (int draggedKind = 0; draggedKind < kLineKindCount; ++draggedKind) {
        if (std::fabs(candidateLine - (result.x + lineOffsetX(snappedDragged, draggedKind))) <=
            kSameLineEpsilon) {
          addGuide(SnapOrientation::vertical, candidateLine, start, end);
          break;
        }
      }
    }
  }
  if (bestY.found) {
    const Rectangle& candidate = document.rectangles()[bestY.slot];
    const double start = std::min(snappedDragged.x, candidate.x) - tokens::space_16;
    const double end = std::max(snappedDragged.x + snappedDragged.width,
                                candidate.x + candidate.width) +
                       tokens::space_16;
    for (int candidateKind = 0; candidateKind < kLineKindCount; ++candidateKind) {
      const double candidateLine = lineY(candidate, candidateKind);
      for (int draggedKind = 0; draggedKind < kLineKindCount; ++draggedKind) {
        if (std::fabs(candidateLine - (result.y + lineOffsetY(snappedDragged, draggedKind))) <=
            kSameLineEpsilon) {
          addGuide(SnapOrientation::horizontal, candidateLine, start, end);
          break;
        }
      }
    }
  }
  result.guideCount = std::min(guideCount, kMaxSnapGuides);
  out = result;
  return Status::success();
}

}  // namespace air::engine
