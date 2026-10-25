#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "contract.h"
#include "engine/geometry.h"
#include "engine/status.h"
#include "tokens.h"

namespace air::engine {

// Draw layers in docs/design-rules.md §8 order, bottom to top. The z-index
// numbers come from the generated ui-kit token header (AD-7, design rule §13),
// never from a copy in the engine. Only the layers that draw rectangles are
// listed: edges (3) are not rectangles and the chrome layers (8+) are DOM.
enum class Layer : std::uint8_t {
  zones = static_cast<std::uint8_t>(tokens::layer_zones),
  blocks = static_cast<std::uint8_t>(tokens::layer_blocks),
  noteCards = static_cast<std::uint8_t>(tokens::layer_note_cards),
};

static_assert(static_cast<int>(Layer::zones) == tokens::layer_zones,
              "Layer::zones must match tokens::layer_zones");
static_assert(static_cast<int>(Layer::blocks) == tokens::layer_blocks,
              "Layer::blocks must match tokens::layer_blocks");
static_assert(static_cast<int>(Layer::noteCards) == tokens::layer_note_cards,
              "Layer::noteCards must match tokens::layer_note_cards");

// Tone reference into the ui-kit palette in tokens.h; the renderer resolves it
// with render::toneColor(Tone). `neutral` is provisional: the contract carries no
// tone, so every board entity starts neutral and P2-03 must not treat its
// mapping to tokens::card as final design.
enum class Tone : std::uint8_t {
  neutral,
  toneA,
  toneB,
  toneC,
  toneD,
  toneE,
};

// One rectangle in the document: world-space geometry (double precision, like
// the contract's x/y/width/height), the contract's fractional-index string as
// the within-layer order key, and a tone reference.
struct Rectangle {
  double x{0.0};
  double y{0.0};
  double width{0.0};
  double height{0.0};
  std::string z;
  Layer layer{Layer::noteCards};
  Tone tone{Tone::neutral};
  std::uint32_t insertionOrder{0};

  Bounds bounds() const { return {x, y, width, height}; }
};

// Flat-array rectangle document. Storage is one std::vector<Rectangle> reserved
// for 50,000 rectangles. Draw order is a precomputed permutation, so ordering a
// frame needs no per-object allocation and no map lookup; culling adds one hash
// lookup per visible grid cell (spatial.h). A Document is non-copyable and
// non-movable so its identity is unique: the spatial index binds to identity plus
// version and can never be applied to a different document that happens to share
// a version.
class Document {
 public:
  // The engine spike caps the document at 50,000 rectangles (P2-02).
  static constexpr std::size_t kMaxRectangles = 50000;

  Document();
  ~Document() = default;
  Document(const Document&) = delete;
  Document& operator=(const Document&) = delete;
  Document(Document&&) = delete;
  Document& operator=(Document&&) = delete;

  // Clears the rectangles; the reserved capacity stays (no per-frame allocation).
  void clear();

  // Appends one rectangle; the document assigns its insertion order.
  // Fails when the document is full or a coordinate is not finite.
  Status addRectangle(Rectangle rectangle);

  // Adds the board's zones, blocks and cards as rectangles in their design
  // layers. Atomic: the whole board is validated (capacity and finite geometry)
  // before the document is mutated. Edges are not rectangles and are ignored.
  Status addBoardContent(const project_air::contracts::BoardContent& content);

  const std::vector<Rectangle>& rectangles() const { return rectangles_; }
  std::size_t size() const { return rectangles_.size(); }

  // Stable draw order: layer (design-rules §8), then fractional z string
  // (lexicographic), then insertion order; equal z keeps insertion order.
  const std::vector<std::uint32_t>& drawOrder() const;

  // Inverse permutation of drawOrder(): drawOrderRank()[index] is the rectangle's
  // position in the command buffer. Reused by the renderer each frame.
  const std::vector<std::uint32_t>& drawOrderRank() const;

  // Increments on every mutation; the spatial index and command buffer compare it.
  std::uint32_t version() const { return version_; }

  // Unique identity of this document instance, assigned once and never reused in
  // the process. The spatial index compares it together with version().
  std::uint64_t instanceId() const { return instanceId_; }

 private:
  void rebuildDrawOrder() const;

  std::uint64_t instanceId_{0};
  std::vector<Rectangle> rectangles_;
  mutable std::vector<std::uint32_t> drawOrder_;
  mutable std::vector<std::uint32_t> drawOrderRank_;
  mutable bool drawOrderDirty_{false};
  std::uint32_t version_{0};
};

}  // namespace air::engine
