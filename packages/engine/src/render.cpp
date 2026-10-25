#include "engine/render.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include "tokens.h"

namespace air::engine {
namespace {

bool viewportIsValid(double viewportWidth, double viewportHeight) {
  return std::isfinite(viewportWidth) && std::isfinite(viewportHeight) && viewportWidth > 0.0 &&
         viewportHeight > 0.0;
}

bool pointIsFinite(Point point) { return std::isfinite(point.x) && std::isfinite(point.y); }

}  // namespace

const char* toneColor(Tone tone) {
  switch (tone) {
    case Tone::neutral:
      // Provisional spike mapping (see doc.h): the contract carries no tone yet.
      return tokens::card;
    case Tone::toneA:
      return tokens::tone_a;
    case Tone::toneB:
      return tokens::tone_b;
    case Tone::toneC:
      return tokens::tone_c;
    case Tone::toneD:
      return tokens::tone_d;
    case Tone::toneE:
      return tokens::tone_e;
  }
  return tokens::card;
}

CommandBuffer::CommandBuffer() { reserve(Document::kMaxRectangles); }

void CommandBuffer::reserve(std::size_t maxInstances) {
  instances_.reserve(maxInstances);
  candidates_.reserve(maxInstances);
}

void CommandBuffer::clear() {
  instances_.clear();
  candidates_.clear();
}

const std::uint8_t* CommandBuffer::bytes() const {
  if (instances_.empty()) {
    return nullptr;
  }
  return reinterpret_cast<const std::uint8_t*>(instances_.data());
}

std::size_t CommandBuffer::byteSize() const { return instances_.size() * sizeof(Instance); }

Status CommandBuffer::build(const Document& document, const Camera& camera,
                            double viewportWidth, double viewportHeight,
                            const SpatialIndex& spatial) {
  // A failed build always leaves an empty buffer (documented in render.h).
  instances_.clear();
  candidates_.clear();

  if (!spatial.isCurrent(document)) {
    return Status::failure(
        "spatial index is stale or belongs to another document; rebuild it for this document");
  }
  if (!viewportIsValid(viewportWidth, viewportHeight)) {
    return Status::failure("viewport size must be a positive finite number");
  }

  const Bounds visible = camera.visibleWorldBounds(viewportWidth, viewportHeight);
  const Status queryStatus = spatial.query(visible, candidates_);
  if (!queryStatus) {
    return queryStatus;
  }

  // Defence in depth: a foreign or corrupted index must never cause an
  // out-of-bounds read while ranking; fail with a reason instead.
  const std::vector<std::uint32_t>& rank = document.drawOrderRank();
  const std::vector<Rectangle>& rectangles = document.rectangles();
  for (const std::uint32_t candidate : candidates_) {
    if (candidate >= rank.size() || candidate >= rectangles.size()) {
      candidates_.clear();
      return Status::failure("spatial index returned an out-of-range rectangle index");
    }
  }

  // Candidates arrive in document (slot) order with overlaps removed by the
  // index; ordering them by the document's draw-order rank makes the buffer
  // stable. Equal ranks are impossible, and removed slots never draw.
  std::sort(candidates_.begin(), candidates_.end(), [&rank](std::uint32_t left, std::uint32_t right) {
    return rank[left] < rank[right];
  });
  candidates_.erase(std::unique(candidates_.begin(), candidates_.end()), candidates_.end());

  const double zoom = camera.zoom();
  for (const std::uint32_t index : candidates_) {
    const Rectangle& rectangle = rectangles[index];
    // A stale index could still name a removed slot; never draw a tombstone.
    if (!rectangle.live) {
      continue;
    }
    if (!rectangle.bounds().intersects(visible)) {
      continue;
    }
    const Point topLeft = camera.worldToScreen({rectangle.x, rectangle.y});
    const double screenWidth = rectangle.width * zoom;
    const double screenHeight = rectangle.height * zoom;
    // The instance record is float; a huge world rectangle must fail loudly
    // instead of silently producing an infinite quad.
    const double floatMax = static_cast<double>(std::numeric_limits<float>::max());
    if (!std::isfinite(topLeft.x) || !std::isfinite(topLeft.y) || !std::isfinite(screenWidth) ||
        !std::isfinite(screenHeight) || std::abs(topLeft.x) > floatMax ||
        std::abs(topLeft.y) > floatMax || std::abs(screenWidth) > floatMax ||
        std::abs(screenHeight) > floatMax) {
      instances_.clear();
      return Status::failure("rectangle quad exceeds the supported float range");
    }
    instances_.push_back(Instance{static_cast<float>(topLeft.x), static_cast<float>(topLeft.y),
                                  static_cast<float>(screenWidth),
                                  static_cast<float>(screenHeight),
                                  static_cast<std::uint32_t>(rectangle.tone),
                                  static_cast<std::uint32_t>(rectangle.layer)});
  }

  return Status::success();
}

Status CommandBuffer::hitTest(const Document& document, const Camera& camera,
                              const SpatialIndex& spatial, double viewportWidth,
                              double viewportHeight, Point screenPoint, HitResult& out) {
  out = HitResult{};
  if (!spatial.isCurrent(document)) {
    return Status::failure(
        "spatial index is stale or belongs to another document; rebuild it for this document");
  }
  if (!viewportIsValid(viewportWidth, viewportHeight)) {
    return Status::failure("viewport size must be a positive finite number");
  }
  if (!pointIsFinite(screenPoint)) {
    return Status::failure("hit test point must be a finite screen point");
  }
  const Point worldPoint = camera.screenToWorld(screenPoint);
  if (!pointIsFinite(worldPoint)) {
    return Status::failure("hit test point is outside the supported world range");
  }

  // One spatial query per hit test, no per-object work in JavaScript. The index
  // reuses its buffers, so a hit test does not allocate per object.
  const Status queryStatus = spatial.queryPoint(worldPoint, candidates_);
  if (!queryStatus) {
    return queryStatus;
  }

  const std::vector<std::uint32_t>& rank = document.drawOrderRank();
  const std::vector<Rectangle>& rectangles = document.rectangles();
  for (const std::uint32_t candidate : candidates_) {
    if (candidate >= rank.size() || candidate >= rectangles.size()) {
      return Status::failure("spatial index returned an out-of-range rectangle index");
    }
    const Rectangle& rectangle = rectangles[candidate];
    if (!rectangle.live) {
      continue;
    }
    // Bounds::contains includes the edges and corners; the draw-order rank picks
    // exactly one object when several include the point.
    if (!rectangle.bounds().contains(worldPoint)) {
      continue;
    }
    if (!out.found || rank[candidate] > rank[out.slot]) {
      out.found = true;
      out.slot = candidate;
      out.objectId = rectangle.id;
    }
  }
  return Status::success();
}

}  // namespace air::engine
