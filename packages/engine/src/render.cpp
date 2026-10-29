#include "engine/render.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include "engine/text_binding.h"
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

// P6-15: the depth-band plan. A band is a maximal run of consecutive draw-order
// objects in which no later object covers the bound text/chrome boxes of an
// earlier object. It is formed in document space from `objectTextBoxes` (the
// same boxes the binding pass draws), so pan/zoom never changes it and the text
// of object N is always drawn before any object above N that could cover it.
Status CommandBuffer::ensureBandPlan(const Document& document, const SpatialIndex& spatial) {
  if (bandPlanValid_ && bandDocumentInstance_ == document.instanceId() &&
      bandDocumentVersion_ == document.version() && spatial.isCurrent(document)) {
    return Status::success();
  }
  bandPlanValid_ = false;

  const std::vector<std::uint32_t>& order = document.drawOrder();
  const std::vector<std::uint32_t>& rank = document.drawOrderRank();
  const std::vector<Rectangle>& rectangles = document.rectangles();
  bandPlan_.clear();
  bandOfRank_.clear();
  if (order.empty()) {
    bandPlanValid_ = true;
    bandDocumentInstance_ = document.instanceId();
    bandDocumentVersion_ = document.version();
    return Status::success();
  }

  // The bound boxes of every live object, in world px: header band, title and
  // preview unioned to one conservative box. Empty boxes never cover anything.
  bandTextBounds_.assign(rectangles.size(), Bounds{});
  for (std::uint32_t slot = 0; slot < rectangles.size(); ++slot) {
    if (!document.isLive(slot)) {
      continue;
    }
    const Rectangle& rectangle = rectangles[slot];
    const ObjectTextBoxes boxes = objectTextBoxes(rectangle);
    // The boxes that can draw text. A zone shows only its name in the header
    // (the app does not bind zone previews), so its content area must not split
    // the band off the members inside it; blocks and cards carry a preview.
    const Bounds* parts[4] = {nullptr, nullptr, nullptr, nullptr};
    std::size_t partCount = 0;
    if (rectangle.layer == Layer::zones) {
      parts[0] = &boxes.band;
      parts[1] = &boxes.rule;
      parts[2] = &boxes.title;
      partCount = 3;
    } else if (rectangle.layer == Layer::blocks) {
      parts[0] = &boxes.band;
      parts[1] = &boxes.rule;
      parts[2] = &boxes.title;
      parts[3] = &boxes.preview;
      partCount = 4;
    } else {
      parts[0] = &boxes.title;
      parts[1] = &boxes.preview;
      partCount = 2;
    }
    Bounds text{};
    bool any = false;
    for (std::size_t partIndex = 0; partIndex < partCount; ++partIndex) {
      const Bounds* part = parts[partIndex];
      if (!(part->width > 0.0) || !(part->height > 0.0)) {
        continue;
      }
      if (!any) {
        text = *part;
        any = true;
        continue;
      }
      const double left = std::min(text.x, part->x);
      const double top = std::min(text.y, part->y);
      const double right = std::max(text.right(), part->right());
      const double bottom = std::max(text.bottom(), part->bottom());
      text = Bounds{left, top, right - left, bottom - top};
    }
    if (any) {
      bandTextBounds_[slot] = text;
    }
  }

  std::uint32_t bandStartRank = 0;
  for (std::size_t position = 0; position < order.size(); ++position) {
    const std::uint32_t slot = order[position];
    const Rectangle& rectangle = rectangles[slot];
    // Ask the index for everything near the new object; any candidate whose text
    // boxes it covers and that is already inside the open band forces a cut.
    const Status queryStatus = spatial.query(rectangle.bounds(), bandCandidates_);
    if (!queryStatus) {
      bandPlan_.clear();
      bandOfRank_.clear();
      return queryStatus;
    }
    bool coversEarlierText = false;
    for (const std::uint32_t candidate : bandCandidates_) {
      if (candidate >= rectangles.size() || candidate >= rank.size()) {
        bandPlan_.clear();
        bandOfRank_.clear();
        return Status::failure("spatial index returned an out-of-range rectangle index");
      }
      if (!document.isLive(candidate)) {
        continue;
      }
      const std::uint32_t candidateRank = rank[candidate];
      if (candidateRank < bandStartRank || candidateRank >= position) {
        continue;  // another band, or the object itself / a later object
      }
      const Bounds& text = bandTextBounds_[candidate];
      if (!(text.width > 0.0) || !(text.height > 0.0)) {
        continue;
      }
      if (text.intersects(rectangle.bounds())) {
        coversEarlierText = true;
        break;
      }
    }
    if (coversEarlierText) {
      bandPlan_.push_back(
          DrawBand{0, 0, bandStartRank, static_cast<std::uint32_t>(position - 1)});
      bandStartRank = static_cast<std::uint32_t>(position);
    }
  }
  bandPlan_.push_back(
      DrawBand{0, 0, bandStartRank, static_cast<std::uint32_t>(order.size() - 1)});

  bandOfRank_.assign(order.size(), 0);
  for (std::size_t band = 0; band < bandPlan_.size(); ++band) {
    for (std::uint32_t r = bandPlan_[band].firstRank; r <= bandPlan_[band].lastRank; ++r) {
      bandOfRank_[r] = static_cast<std::uint32_t>(band);
    }
  }
  bandPlanValid_ = true;
  bandDocumentInstance_ = document.instanceId();
  bandDocumentVersion_ = document.version();
  return Status::success();
}

Status CommandBuffer::build(const Document& document, const Camera& camera,
                            double viewportWidth, double viewportHeight,
                            const SpatialIndex& spatial, bool interleave) {
  // A failed build always leaves an empty buffer (documented in render.h).
  instances_.clear();
  candidates_.clear();
  bands_.clear();

  if (!spatial.isCurrent(document)) {
    return Status::failure(
        "spatial index is stale or belongs to another document; rebuild it for this document");
  }
  if (!viewportIsValid(viewportWidth, viewportHeight)) {
    return Status::failure("viewport size must be a positive finite number");
  }
  if (interleave) {
    const Status planStatus = ensureBandPlan(document, spatial);
    if (!planStatus) {
      return planStatus;
    }
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

  // Instances are grouped into depth bands in draw order. A band that loses all
  // its visible objects is skipped, so the renderer only ever sees non-empty
  // bands; the rank range is the visible range, which is what the text pass maps
  // its runs onto.
  std::size_t openStart = 0;
  std::uint32_t openBand = 0;
  std::uint32_t openFirstRank = 0;
  std::uint32_t openLastRank = 0;
  bool open = false;
  const auto closeBand = [&]() {
    if (open && instances_.size() > openStart) {
      bands_.push_back(
          DrawBand{openStart, instances_.size() - openStart, openFirstRank, openLastRank});
    }
    open = false;
  };

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
      bands_.clear();
      return Status::failure("rectangle quad exceeds the supported float range");
    }
    const std::uint32_t objectRank = rank[index];
    const std::uint32_t bandId =
        interleave && objectRank < bandOfRank_.size() ? bandOfRank_[objectRank] : 0;
    if (!open) {
      open = true;
      openStart = instances_.size();
      openBand = bandId;
      openFirstRank = objectRank;
    } else if (bandId != openBand) {
      closeBand();
      open = true;
      openStart = instances_.size();
      openBand = bandId;
      openFirstRank = objectRank;
    }
    openLastRank = objectRank;
    instances_.push_back(Instance{static_cast<float>(topLeft.x), static_cast<float>(topLeft.y),
                                  static_cast<float>(screenWidth),
                                  static_cast<float>(screenHeight),
                                  static_cast<std::uint32_t>(rectangle.tone),
                                  static_cast<std::uint32_t>(rectangle.layer)});
  }
  closeBand();

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
