#include "engine/doc.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
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

// A rectangle is accepted only when every component is finite and neither
// x + width nor y + height overflows the double range: a later bounds() call must
// never produce a non-finite edge.
bool geometryIsValid(double x, double y, double width, double height) {
  return isFinite(x) && isFinite(y) && isFinite(width) && isFinite(height) &&
         isFinite(x + width) && isFinite(y + height);
}

bool rectangleGeometryIsValid(const Rectangle& rectangle) {
  return geometryIsValid(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
}

bool geometryIsFinite(const project_air::contracts::Zone& zone) {
  return geometryIsValid(zone.x, zone.y, zone.width, zone.height);
}

bool geometryIsFinite(const project_air::contracts::Block& block) {
  return geometryIsValid(block.x, block.y, block.width, block.height);
}

bool geometryIsFinite(const project_air::contracts::Card& card) {
  return geometryIsValid(card.x, card.y, card.width, card.height);
}

// The contract carries no tone, so every entity starts neutral (provisional, see
// doc.h). P2-03 must not treat this as final design.
Rectangle fromEntity(const project_air::contracts::Zone& zone) {
  Rectangle rectangle;
  rectangle.x = zone.x;
  rectangle.y = zone.y;
  rectangle.width = zone.width;
  rectangle.height = zone.height;
  rectangle.z = zone.z;
  rectangle.layer = Layer::zones;
  return rectangle;
}

Rectangle fromEntity(const project_air::contracts::Block& block) {
  Rectangle rectangle;
  rectangle.x = block.x;
  rectangle.y = block.y;
  rectangle.width = block.width;
  rectangle.height = block.height;
  rectangle.z = block.z;
  rectangle.layer = Layer::blocks;
  return rectangle;
}

Rectangle fromEntity(const project_air::contracts::Card& card) {
  Rectangle rectangle;
  rectangle.x = card.x;
  rectangle.y = card.y;
  rectangle.width = card.width;
  rectangle.height = card.height;
  rectangle.z = card.z;
  rectangle.layer = Layer::noteCards;
  return rectangle;
}

}  // namespace

Tone toneFromOrdinal(int ordinal) {
  return static_cast<Tone>(std::clamp(ordinal, 0, static_cast<int>(Tone::toneE)));
}

Layer layerFromOrdinal(int ordinal) {
  switch (std::clamp(ordinal, 0, 2)) {
    case 0:
      return Layer::zones;
    case 1:
      return Layer::blocks;
    default:
      return Layer::noteCards;
  }
}

Document::Document() : instanceId_(allocateDocumentId()) {
  rectangles_.reserve(kMaxRectangles);
  freeSlots_.reserve(kMaxRectangles);
  drawOrder_.reserve(kMaxRectangles);
  drawOrderRank_.reserve(kMaxRectangles);
}

void Document::clear() {
  rectangles_.clear();
  freeSlots_.clear();
  slotsById_.clear();
  liveCount_ = 0;
  drawOrder_.clear();
  drawOrderRank_.clear();
  drawOrderDirty_ = false;
  // nextObjectId_ and nextInsertionOrder_ are deliberately not reset: ids and
  // insertion order are never reused, not even by a full document reload.
  ++version_;
}

Status Document::addObject(Rectangle rectangle, ObjectId& objectId) {
  objectId = kInvalidObjectId;
  if (liveCount_ >= kMaxRectangles) {
    return Status::failure("document is full: at most 50000 objects");
  }
  if (!rectangleGeometryIsValid(rectangle)) {
    return Status::failure("rectangle coordinates must be finite and must not overflow");
  }

  // A removed slot is reusable, the identity and the insertion order are not.
  std::uint32_t slot = 0;
  if (!freeSlots_.empty()) {
    slot = freeSlots_.back();
    freeSlots_.pop_back();
  } else {
    slot = static_cast<std::uint32_t>(rectangles_.size());
    rectangles_.emplace_back();
  }

  const ObjectId id = nextObjectId_++;
  rectangle.id = id;
  rectangle.live = true;
  rectangle.insertionOrder = nextInsertionOrder_++;
  rectangles_[slot] = std::move(rectangle);
  slotsById_.emplace(id, slot);
  ++liveCount_;
  drawOrderDirty_ = true;
  ++version_;
  objectId = id;
  return Status::success();
}

Status Document::addRectangle(Rectangle rectangle) {
  ObjectId ignored = kInvalidObjectId;
  return addObject(std::move(rectangle), ignored);
}

Status Document::addBoardContent(const project_air::contracts::BoardContent& content) {
  // Validate everything before mutating so a rejected board leaves the document
  // untouched. The capacity guard is written so `total > kMaxRectangles` cannot
  // underflow the size_t subtraction and slip through.
  const std::size_t total = content.zones.size() + content.blocks.size() + content.cards.size();
  if (total > kMaxRectangles || liveCount_ > kMaxRectangles - total) {
    return Status::failure("board content exceeds the 50000-rectangle document");
  }
  for (const project_air::contracts::Zone& zone : content.zones) {
    if (!geometryIsFinite(zone)) {
      return Status::failure("board content geometry must be finite and must not overflow");
    }
  }
  for (const project_air::contracts::Block& block : content.blocks) {
    if (!geometryIsFinite(block)) {
      return Status::failure("board content geometry must be finite and must not overflow");
    }
  }
  for (const project_air::contracts::Card& card : content.cards) {
    if (!geometryIsFinite(card)) {
      return Status::failure("board content geometry must be finite and must not overflow");
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

Status Document::loadPackedRectangles(const float* packed, int count) {
  constexpr int kPackedStride = 6;
  if (count < 0 || static_cast<std::size_t>(count) > kMaxRectangles) {
    return Status::failure("rectangle count is outside the supported range");
  }
  if (count > 0 && packed == nullptr) {
    return Status::failure("rectangle data must not be null");
  }

  // Validate and convert the whole array before clearing the content: a rejected
  // load must leave the previous document and its spatial index untouched.
  std::vector<Rectangle> rectangles;
  rectangles.reserve(static_cast<std::size_t>(count));
  for (int index = 0; index < count; ++index) {
    const float* data =
        packed + static_cast<std::size_t>(index) * static_cast<std::size_t>(kPackedStride);
    if (!geometryIsValid(data[0], data[1], data[2], data[3])) {
      return Status::failure("rectangle coordinates must be finite and must not overflow");
    }
    if (!isFinite(data[4]) || !isFinite(data[5])) {
      return Status::failure("rectangle tone and layer ordinals must be finite");
    }
    Rectangle rectangle;
    rectangle.x = data[0];
    rectangle.y = data[1];
    rectangle.width = data[2];
    rectangle.height = data[3];
    rectangle.tone =
        toneFromOrdinal(static_cast<int>(std::lround(std::clamp(data[4], 0.0F, 5.0F))));
    rectangle.layer =
        layerFromOrdinal(static_cast<int>(std::lround(std::clamp(data[5], 0.0F, 2.0F))));
    char fractionalIndex[16] = {};
    std::snprintf(fractionalIndex, sizeof(fractionalIndex), "%012d", index);
    rectangle.z = fractionalIndex;
    rectangles.push_back(std::move(rectangle));
  }

  clear();
  for (Rectangle& rectangle : rectangles) {
    ObjectId ignored = kInvalidObjectId;
    const Status status = addObject(std::move(rectangle), ignored);
    if (!status) {
      // Unreachable after the validation and the capacity check above; keep the
      // document usable instead of half loaded if it ever happens.
      clear();
      return status;
    }
  }
  return Status::success();
}

Status Document::updateGeometry(ObjectId objectId, double x, double y, double width,
                                double height) {
  std::uint32_t slot = 0;
  const Status status = slotForId(objectId, slot);
  if (!status) {
    return status;
  }
  if (!geometryIsValid(x, y, width, height)) {
    return Status::failure("rectangle coordinates must be finite and must not overflow");
  }
  Rectangle& rectangle = rectangles_[slot];
  rectangle.x = x;
  rectangle.y = y;
  rectangle.width = width;
  rectangle.height = height;
  // Geometry is not part of the draw order, so the permutation stays valid.
  ++version_;
  return Status::success();
}

Status Document::updateZ(ObjectId objectId, std::string z) {
  std::uint32_t slot = 0;
  const Status status = slotForId(objectId, slot);
  if (!status) {
    return status;
  }
  rectangles_[slot].z = std::move(z);
  drawOrderDirty_ = true;
  ++version_;
  return Status::success();
}

Status Document::removeObject(ObjectId objectId) {
  std::uint32_t slot = 0;
  const Status status = slotForId(objectId, slot);
  if (!status) {
    return status;
  }
  // Tombstone the slot so a stale index or buffer can never draw its old
  // geometry; the freed slot is reused by a later insert, the id is not.
  rectangles_[slot] = Rectangle{};
  slotsById_.erase(objectId);
  freeSlots_.push_back(slot);
  --liveCount_;
  drawOrderDirty_ = true;
  ++version_;
  return Status::success();
}

Status Document::slotForId(ObjectId objectId, std::uint32_t& slot) const {
  const auto found = slotsById_.find(objectId);
  if (found == slotsById_.end()) {
    return Status::failure("unknown object id");
  }
  if (found->second >= rectangles_.size() || !rectangles_[found->second].live) {
    return Status::failure("unknown object id");
  }
  slot = found->second;
  return Status::success();
}

bool Document::isLive(std::uint32_t slot) const {
  return slot < rectangles_.size() && rectangles_[slot].live;
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
  drawOrder_.clear();
  for (std::size_t slot = 0; slot < rectangles_.size(); ++slot) {
    if (rectangles_[slot].live) {
      drawOrder_.push_back(static_cast<std::uint32_t>(slot));
    }
  }
  std::sort(drawOrder_.begin(), drawOrder_.end(),
            [this](std::uint32_t leftSlot, std::uint32_t rightSlot) {
              const Rectangle& left = rectangles_[leftSlot];
              const Rectangle& right = rectangles_[rightSlot];
              if (left.layer != right.layer) {
                return static_cast<std::uint8_t>(left.layer) <
                       static_cast<std::uint8_t>(right.layer);
              }
              if (left.z != right.z) {
                return left.z < right.z;
              }
              return left.insertionOrder < right.insertionOrder;
            });
  // Tombstones are not part of the permutation; they rank after every live slot
  // and are filtered by the command buffer.
  drawOrderRank_.assign(rectangles_.size(), static_cast<std::uint32_t>(drawOrder_.size()));
  for (std::size_t rank = 0; rank < drawOrder_.size(); ++rank) {
    drawOrderRank_[drawOrder_[rank]] = static_cast<std::uint32_t>(rank);
  }
  drawOrderDirty_ = false;
}

}  // namespace air::engine
