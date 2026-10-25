#include "engine/doc.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <utility>

namespace air::engine {
namespace {

// Monotonic per-process document identity; never reused, so a stale spatial
// index can never match a later document that reuses an address.
std::uint64_t allocateDocumentId() {
  static std::atomic<std::uint64_t> nextId{1};
  return nextId.fetch_add(1, std::memory_order_relaxed);
}

bool isFinite(double value) { return std::isfinite(value); }

bool geometryIsFinite(const project_air::contracts::Zone& zone) {
  return isFinite(zone.x) && isFinite(zone.y) && isFinite(zone.width) && isFinite(zone.height);
}

bool geometryIsFinite(const project_air::contracts::Block& block) {
  return isFinite(block.x) && isFinite(block.y) && isFinite(block.width) &&
         isFinite(block.height);
}

bool geometryIsFinite(const project_air::contracts::Card& card) {
  return isFinite(card.x) && isFinite(card.y) && isFinite(card.width) && isFinite(card.height);
}

// The contract carries no tone, so every entity starts neutral (provisional, see
// doc.h). P2-03 must not treat this as final design.
Rectangle fromEntity(const project_air::contracts::Zone& zone) {
  return {zone.x, zone.y, zone.width, zone.height, zone.z, Layer::zones, Tone::neutral, 0};
}

Rectangle fromEntity(const project_air::contracts::Block& block) {
  return {block.x, block.y, block.width, block.height, block.z, Layer::blocks, Tone::neutral,
          0};
}

Rectangle fromEntity(const project_air::contracts::Card& card) {
  return {card.x, card.y, card.width, card.height, card.z, Layer::noteCards, Tone::neutral, 0};
}

}  // namespace

Document::Document() : instanceId_(allocateDocumentId()) {
  rectangles_.reserve(kMaxRectangles);
  drawOrder_.reserve(kMaxRectangles);
  drawOrderRank_.reserve(kMaxRectangles);
}

void Document::clear() {
  rectangles_.clear();
  drawOrder_.clear();
  drawOrderRank_.clear();
  drawOrderDirty_ = false;
  ++version_;
}

Status Document::addRectangle(Rectangle rectangle) {
  if (rectangles_.size() >= kMaxRectangles) {
    return Status::failure("document is full: at most 50000 rectangles");
  }
  if (!isFinite(rectangle.x) || !isFinite(rectangle.y) || !isFinite(rectangle.width) ||
      !isFinite(rectangle.height)) {
    return Status::failure("rectangle coordinates must be finite");
  }
  rectangle.insertionOrder = static_cast<std::uint32_t>(rectangles_.size());
  rectangles_.push_back(std::move(rectangle));
  drawOrderDirty_ = true;
  ++version_;
  return Status::success();
}

Status Document::addBoardContent(const project_air::contracts::BoardContent& content) {
  // Validate everything before mutating so a rejected board leaves the document
  // untouched. The capacity guard is written so `total > kMaxRectangles` cannot
  // underflow the size_t subtraction and slip through.
  const std::size_t total = content.zones.size() + content.blocks.size() + content.cards.size();
  if (total > kMaxRectangles || rectangles_.size() > kMaxRectangles - total) {
    return Status::failure("board content exceeds the 50000-rectangle document");
  }
  for (const project_air::contracts::Zone& zone : content.zones) {
    if (!geometryIsFinite(zone)) {
      return Status::failure("board content geometry must be finite");
    }
  }
  for (const project_air::contracts::Block& block : content.blocks) {
    if (!geometryIsFinite(block)) {
      return Status::failure("board content geometry must be finite");
    }
  }
  for (const project_air::contracts::Card& card : content.cards) {
    if (!geometryIsFinite(card)) {
      return Status::failure("board content geometry must be finite");
    }
  }

  for (const project_air::contracts::Zone& zone : content.zones) {
    const Status status = addRectangle(fromEntity(zone));
    if (!status) {
      return status;
    }
  }
  for (const project_air::contracts::Block& block : content.blocks) {
    const Status status = addRectangle(fromEntity(block));
    if (!status) {
      return status;
    }
  }
  for (const project_air::contracts::Card& card : content.cards) {
    const Status status = addRectangle(fromEntity(card));
    if (!status) {
      return status;
    }
  }
  return Status::success();
}

const std::vector<std::uint32_t>& Document::drawOrder() const {
  if (drawOrderDirty_) {
    rebuildDrawOrder();
  }
  return drawOrder_;
}

const std::vector<std::uint32_t>& Document::drawOrderRank() const {
  if (drawOrderDirty_) {
    rebuildDrawOrder();
  }
  return drawOrderRank_;
}

void Document::rebuildDrawOrder() const {
  const std::size_t count = rectangles_.size();
  drawOrder_.resize(count);
  for (std::size_t index = 0; index < count; ++index) {
    drawOrder_[index] = static_cast<std::uint32_t>(index);
  }
  std::sort(drawOrder_.begin(), drawOrder_.end(),
            [this](std::uint32_t leftIndex, std::uint32_t rightIndex) {
              const Rectangle& left = rectangles_[leftIndex];
              const Rectangle& right = rectangles_[rightIndex];
              if (left.layer != right.layer) {
                return static_cast<std::uint8_t>(left.layer) <
                       static_cast<std::uint8_t>(right.layer);
              }
              if (left.z != right.z) {
                return left.z < right.z;
              }
              return left.insertionOrder < right.insertionOrder;
            });
  drawOrderRank_.resize(count);
  for (std::size_t rank = 0; rank < count; ++rank) {
    drawOrderRank_[drawOrder_[rank]] = static_cast<std::uint32_t>(rank);
  }
  drawOrderDirty_ = false;
}

}  // namespace air::engine
