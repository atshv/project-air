#include "engine/text_binding.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

#include "tokens.h"

namespace air::engine {
namespace {

constexpr std::uint32_t kTitleRole = static_cast<std::uint32_t>(TextRole::title);
constexpr std::uint32_t kBodyRole = static_cast<std::uint32_t>(TextRole::body);
constexpr double kGeometryEpsilon = 1e-9;

// Performance constants, not design values. A board-wide binding stops after this
// many runs (document order), so one viewport can never exhaust the P4-09 run and
// glyph limits; 2,048 runs are roughly 50,000 code points of title and preview.
constexpr std::size_t kMaxBoundRuns = 2048;

TextStyle styleOf(std::uint32_t role) {
  TextStyle style;
  // Both ordinals are constants of this module, so the lookup cannot fail.
  (void)textStyle(role, style);
  return style;
}

double lineHeightOf(std::uint32_t role) {
  const TextStyle style = styleOf(role);
  return style.fontSize * style.lineHeight;
}

// One header chrome quad of a world rectangle, mapped through the camera.
ChromeInstance toScreen(const Bounds& world, const Camera& camera, std::uint32_t kind) {
  const double zoom = camera.zoom();
  ChromeInstance instance;
  instance.x = static_cast<float>((world.x - camera.panX()) * zoom);
  instance.y = static_cast<float>((world.y - camera.panY()) * zoom);
  instance.width = static_cast<float>(world.width * zoom);
  instance.height = static_cast<float>(world.height * zoom);
  instance.kind = kind;
  return instance;
}

bool codePointsValid(const std::uint32_t* codePoints, std::uint32_t count) {
  if (count > 0 && codePoints == nullptr) {
    return false;
  }
  for (std::uint32_t index = 0; index < count; ++index) {
    if (codePoints[index] > kMaxCodePoint) {
      return false;
    }
  }
  return true;
}

// True when a visible object in a higher design layer covers the header band. The
// band belongs to the lower object, so it must not draw above a card that lies on
// top of it; the binding then drops the chrome instead of overpainting the card.
bool headerOccluded(const Document& document, const SpatialIndex& spatial,
                    const Rectangle& rectangle, const Bounds& band,
                    std::vector<std::uint32_t>& candidates) {
  const Status status = spatial.query(band, candidates);
  if (!status) {
    return true;  // fail closed: no chrome without a current index
  }
  for (const std::uint32_t slot : candidates) {
    if (slot >= document.rectangles().size()) {
      continue;
    }
    const Rectangle& other = document.rectangles()[slot];
    if (!other.live) {
      continue;
    }
    if (static_cast<std::uint8_t>(other.layer) <=
        static_cast<std::uint8_t>(rectangle.layer)) {
      continue;
    }
    if (other.bounds().intersects(band)) {
      return true;
    }
  }
  return false;
}

}  // namespace

ObjectTextBoxes objectTextBoxes(const Rectangle& rectangle) {
  ObjectTextBoxes boxes;
  const double padding = tokens::space_16;
  const double titleLineHeight = lineHeightOf(kTitleRole);
  const Bounds bounds = rectangle.bounds();
  // L02: a title never runs under the quiet delete affordance that appears on
  // hover, focus or selection (design rule §6); the title box reserves the card
  // button width plus its offset, so the cut is the same in every state.
  const double actionWidth = tokens::button_card + tokens::space_8;
  boxes.title.width = std::max(0.0, rectangle.width - 2.0 * padding - actionWidth);
  boxes.title.height = titleLineHeight;

  if (rectangle.layer == Layer::noteCards) {
    // A card has no header band: the title follows the top padding and the
    // preview follows the title's line box.
    boxes.title.x = rectangle.x + padding;
    boxes.title.y = rectangle.y + padding;
    boxes.preview.x = rectangle.x + padding;
    boxes.preview.y = rectangle.y + padding + titleLineHeight + tokens::space_8;
    boxes.preview.width = boxes.title.width;
    boxes.preview.height = std::max(0.0, bounds.bottom() - padding - boxes.preview.y);
    return boxes;
  }

  // L02 chrome geometry: a 40 px header band with the title centred in it; the
  // content starts below the band plus the content padding (40 + 16 px).
  boxes.header = true;
  const double bandHeight = std::min(tokens::header_height, rectangle.height);
  boxes.headerHeight = bandHeight;
  boxes.contentInset = tokens::header_height + padding;
  boxes.title.x = rectangle.x + padding;
  boxes.title.y = std::min(rectangle.y + (bandHeight - titleLineHeight) / 2.0,
                           bounds.bottom() - titleLineHeight);
  boxes.title.y = std::max(rectangle.y, boxes.title.y);
  boxes.band = Bounds{rectangle.x, rectangle.y, rectangle.width, bandHeight};
  if (rectangle.height >= tokens::header_height) {
    boxes.rule = Bounds{rectangle.x, rectangle.y + tokens::header_height, rectangle.width,
                        tokens::border_width};
  }
  boxes.preview.x = rectangle.x + padding;
  boxes.preview.y = rectangle.y + boxes.contentInset;
  boxes.preview.width = boxes.title.width;
  boxes.preview.height = std::max(0.0, bounds.bottom() - padding - boxes.preview.y);
  return boxes;
}

Status textRequiredHeight(const GlyphAtlas& atlas, const Rectangle& rectangle,
                          const std::uint32_t* preview, std::uint32_t previewCount,
                          double& out) {
  if (!codePointsValid(preview, previewCount)) {
    return Status::failure("preview code points are invalid");
  }
  if (!std::isfinite(rectangle.x) || !std::isfinite(rectangle.y) ||
      !std::isfinite(rectangle.width) || !std::isfinite(rectangle.height)) {
    return Status::failure("rectangle geometry must be finite");
  }
  const ObjectTextBoxes boxes = objectTextBoxes(rectangle);
  out = boxes.preview.y - rectangle.y + tokens::space_16;
  if (previewCount == 0) {
    return Status::success();
  }
  if (!atlas.ready()) {
    return Status::failure("glyph atlas is not ready");
  }
  // The required height is the unclipped content height: the clip of the current
  // box only says how much is visible, not how much the object needs.
  constexpr double kUnboundedBoxHeight = 1e9;
  TextLayout layout;
  const Status status =
      layoutText(atlas, kBodyRole, TextFlow::wrap, boxes.preview.width, kUnboundedBoxHeight,
                 preview, previewCount, layout);
  if (!status) {
    return status;
  }
  out = boxes.preview.y - rectangle.y + layout.height + tokens::space_16;
  return Status::success();
}

Status TextBindings::set(const Document& document, std::uint32_t slot,
                         const std::uint32_t* title, std::uint32_t titleCount,
                         const std::uint32_t* preview, std::uint32_t previewCount) {
  if (slot >= document.rectangles().size() || !document.isLive(slot)) {
    return Status::failure("object slot is not a live object");
  }
  if (!codePointsValid(title, titleCount) || !codePointsValid(preview, previewCount)) {
    return Status::failure("text code points are invalid");
  }
  if (documentInstance_ != document.instanceId()) {
    // A different document never matches the stored ObjectIds; start clean so
    // stale entries cannot accumulate across loads.
    entries_.clear();
    documentInstance_ = document.instanceId();
  }
  const ObjectId id = document.rectangles()[slot].id;
  ObjectText text;
  if (titleCount > 0) {
    text.title.assign(title, title + titleCount);
  }
  if (previewCount > 0) {
    text.preview.assign(preview, preview + previewCount);
  }
  entries_.insert_or_assign(id, std::move(text));
  return Status::success();
}

void TextBindings::clear() {
  entries_.clear();
  documentInstance_ = 0;
}

const ObjectText* TextBindings::find(ObjectId objectId) const {
  const auto entry = entries_.find(objectId);
  return entry == entries_.end() ? nullptr : &entry->second;
}

Status TextBindings::bindVisible(const Document& document, const Camera& camera,
                                 const SpatialIndex& spatial, double viewportWidth,
                                 double viewportHeight, TextRuns& runs,
                                 std::vector<ChromeInstance>& chrome) const {
  runs.clear();
  chrome.clear();
  if (!std::isfinite(viewportWidth) || !std::isfinite(viewportHeight) || viewportWidth <= 0.0 ||
      viewportHeight <= 0.0) {
    return Status::failure("viewport must be positive and finite");
  }
  if (entries_.empty()) {
    return Status::success();
  }
  if (!spatial.isCurrent(document)) {
    return Status::failure("spatial index is stale for the document");
  }
  const Bounds visible = camera.visibleWorldBounds(viewportWidth, viewportHeight);
  if (!std::isfinite(visible.x) || !std::isfinite(visible.y) ||
      !std::isfinite(visible.width) || !std::isfinite(visible.height)) {
    return Status::failure("visible world bounds must be finite");
  }
  std::vector<std::uint32_t> candidates;
  const Status queryStatus = spatial.query(visible, candidates);
  if (!queryStatus) {
    return queryStatus;
  }
  const double titleLineHeight = lineHeightOf(kTitleRole);
  const double zoom = camera.zoom();
  std::vector<std::uint32_t> occluders;
  for (const std::uint32_t slot : candidates) {
    if (runs.runs().size() >= kMaxBoundRuns) {
      break;
    }
    if (slot >= document.rectangles().size()) {
      continue;  // defence in depth: a stale candidate is never dereferenced
    }
    const Rectangle& rectangle = document.rectangles()[slot];
    if (!rectangle.live) {
      continue;
    }
    const auto entry = entries_.find(rectangle.id);
    if (entry == entries_.end()) {
      continue;
    }
    if (!rectangle.bounds().intersects(visible)) {
      continue;  // the grid cell intersects, the exact bounds do not
    }
    // Readable-size bound: an object whose on-screen height is smaller than one
    // title line cannot show its text, so a zoomed-out board binds no runs.
    if (rectangle.height * zoom + kGeometryEpsilon < titleLineHeight) {
      continue;
    }
    const ObjectTextBoxes boxes = objectTextBoxes(rectangle);
    const ObjectText& text = entry->second;
    if (!text.title.empty()) {
      const Status status =
          runs.add(boxes.title.x, boxes.title.y, kTitleRole, TextFlow::ellipsis,
                   boxes.title.width, boxes.title.height, text.title.data(),
                   static_cast<std::uint32_t>(text.title.size()));
      if (!status) {
        break;  // run/glyph budget of the P4-09 store
      }
    }
    if (!text.preview.empty() && boxes.preview.width > 0.0 && boxes.preview.height > 0.0) {
      const Status status =
          runs.add(boxes.preview.x, boxes.preview.y, kBodyRole, TextFlow::wrap,
                   boxes.preview.width, boxes.preview.height, text.preview.data(),
                   static_cast<std::uint32_t>(text.preview.size()));
      if (!status) {
        break;  // run/glyph budget of the P4-09 store
      }
    }
    if (boxes.header && !headerOccluded(document, spatial, rectangle, boxes.band, occluders)) {
      chrome.push_back(toScreen(boxes.band, camera, kChromeHeaderBand));
      if (boxes.rule.height > 0.0) {
        chrome.push_back(toScreen(boxes.rule, camera, kChromeHeaderRule));
      }
    }
  }
  return Status::success();
}

}  // namespace air::engine
