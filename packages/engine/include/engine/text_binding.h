#pragma once

// L02 (P4-10) presentation binding: caller-supplied titles and previews bound to
// the objects of the working copy, plus the chrome geometry of cards, blocks and
// zones.
//
// Presentation input only: the engine draws the text for visible objects and the
// document keeps no note content (AD-4). Geometry comes from tokens.h (AD-7): the
// header band is tokens::header_height (40 px), the padding tokens::space_16, the
// title role tokens::text_15 / tokens::weight_semibold. The layout reuses the
// P4-09 flows — `ellipsis` for titles, `wrap` clipped to its box for previews —
// in CSS px, so the binding is independent of the device pixel ratio and of the
// zoom (a zoom bucket changes the atlas raster scale, never the layout).

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "engine/doc.h"
#include "engine/geometry.h"
#include "engine/spatial.h"
#include "engine/text.h"

namespace air::engine {

// Header chrome of one object, in screen (CSS) px: `kind` selects the tokens.h
// colour in the glyph pass (band = tokens::faint, rule = tokens::border). Chrome
// never enters the object command buffer, so the instance counts of the object
// pass stay exactly the document's objects.
enum : std::uint32_t {
  kChromeHeaderBand = 0,
  kChromeHeaderRule = 1,
};

struct ChromeInstance {
  float x{0.0F};
  float y{0.0F};
  float width{0.0F};
  float height{0.0F};
  std::uint32_t kind{0};
};
static_assert(sizeof(ChromeInstance) == 20, "chrome instance layout is the glyph-pass seam");

// L02 boxes of one rectangle in world (CSS) px. A card carries a title and a
// preview below it; a zone or a block carries a 40 px header band with the title
// centred in it and its content below the band (40 + 16 px inset).
struct ObjectTextBoxes {
  bool header{false};        // true for zones and blocks
  double headerHeight{0.0};  // tokens::header_height for zones/blocks, 0 for cards
  double contentInset{0.0};  // world px from the object top to its content
  Bounds band;               // header band in world px; empty for cards
  Bounds rule;               // 1 px rule at the band's bottom edge; empty for cards
  Bounds title;              // ellipsis box; reserves the remove-affordance width
  Bounds preview;            // wrap/clip box of the body preview
};

// Boxes of one rectangle, only from tokens.h and the rectangle's own geometry.
// Deterministic: identical input gives identical boxes. An object shorter than
// its header keeps the band inside its own height and drops the rule when the
// header does not fit.
ObjectTextBoxes objectTextBoxes(const Rectangle& rectangle);

// Height the object needs so its preview is not clipped: the chrome above the
// preview plus the unclipped preview height plus the bottom padding. A block
// grows to this height instead of scrolling internally (L02). Needs a ready atlas
// for a non-empty preview; an empty preview yields the minimal height of its kind.
Status textRequiredHeight(const GlyphAtlas& atlas, const Rectangle& rectangle,
                          const std::uint32_t* preview, std::uint32_t previewCount,
                          double& out);

// Presentation text of one object: a title drawn with `ellipsis` and a short
// preview drawn with `wrap`/clip. Empty vectors draw nothing.
struct ObjectText {
  std::vector<std::uint32_t> title;
  std::vector<std::uint32_t> preview;
};

class TextBindings {
 public:
  // Binds the presentation text of the live object at document slot `slot`. The
  // entry is keyed by the document's stable ObjectId, so it can never match a
  // different object after a reload, and every entry is dropped as soon as the
  // document instance changes. A null pointer with a non-zero count or a code
  // point above U+10FFFF is rejected and leaves the store untouched.
  Status set(const Document& document, std::uint32_t slot, const std::uint32_t* title,
             std::uint32_t titleCount, const std::uint32_t* preview,
             std::uint32_t previewCount);

  // Drops every entry.
  void clear();

  // The bound text of one object id, or nullptr when it has no binding.
  const ObjectText* find(ObjectId objectId) const;

  bool empty() const { return entries_.empty(); }
  std::size_t size() const { return entries_.size(); }

  // Fills `runs` and `chrome` with the title/preview runs and the header chrome
  // of the objects visible in the viewport, in document order. Text is bound only
  // for visible objects (culling) whose on-screen height fits the title line box,
  // and a documented run budget keeps a full board inside the P4-09 limits. Both
  // outputs are cleared first. Fails for a stale or foreign spatial index or a
  // viewport that is not positive and finite.
  Status bindVisible(const Document& document, const Camera& camera,
                     const SpatialIndex& spatial, double viewportWidth, double viewportHeight,
                     TextRuns& runs, std::vector<ChromeInstance>& chrome) const;

  // P6-15: same binding, also reporting the draw-order rank of the object that
  // produced each run and each chrome quad, so the glyph pass can sort them into
  // depth bands. The rank vectors are cleared first and always parallel to the
  // runs/chrome they accompany.
  Status bindVisible(const Document& document, const Camera& camera,
                     const SpatialIndex& spatial, double viewportWidth, double viewportHeight,
                     TextRuns& runs, std::vector<ChromeInstance>& chrome,
                     std::vector<std::uint32_t>& runRanks,
                     std::vector<std::uint32_t>& chromeRanks) const;

 private:
  std::unordered_map<ObjectId, ObjectText> entries_;
  std::uint64_t documentInstance_{0};
};

}  // namespace air::engine
