#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "contract.h"
#include "engine/geometry.h"
#include "engine/status.h"
#include "tokens.h"

namespace air::engine {

// Draw layers in docs/design-rules.md §8 order, bottom to top. The z-index
// numbers come from the generated ui-kit token header (AD-7, design rule §13),
// never from a copy in the engine. Only the layers that draw rectangles are
// listed: edges (2) are not rectangles and the chrome layers (8+) are DOM.
// Design rule §8, quoted: "2 | Edges (connections)", "3 | Zones", "4 | Blocks
// (checklist, palette, columns, timeline, table)", "5 | Note cards", "6 | Element
// just dragged or selected (temporarily at the top of its layer)". Layer 6 is not
// a separate layer here: "top of its layer" is the greatest fractional z inside
// the object's own layer, stored through the contract `reorder` (L13, P4-06).
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

// Maps the C ABI tone ordinals (0 = neutral, 1..5 = tone A..E, documented on
// engine_load_rectangles) to the document enum; out-of-range ordinals clamp like
// the spike loader did.
Tone toneFromOrdinal(int ordinal);

// Maps the C ABI layer ordinals (0 = zones, 1 = blocks, 2 = note cards) to the
// design layer; out-of-range ordinals clamp.
Layer layerFromOrdinal(int ordinal);

// Stable object identity, assigned monotonically by the document and never
// reused: not after removal, not after Document::clear(). It is independent of
// the contract's UUID strings (the bridge owns that mapping) and is never hashed
// or parsed by the core. 0 means "no object" (kInvalidObjectId).
using ObjectId = std::uint64_t;
inline constexpr ObjectId kInvalidObjectId = 0;

// One rectangle in the document: world-space geometry (double precision, like
// the contract's x/y/width/height), the contract's fractional-index string as
// the within-layer order key, and a tone reference. Storage keeps removed slots
// as tombstones (`live == false`); a later insert may reuse the slot. The object
// id and the insertion order are never reset, so both stay unique for the
// lifetime of the document (clear() does not reuse either sequence).
struct Rectangle {
  double x{0.0};
  double y{0.0};
  double width{0.0};
  double height{0.0};
  std::string z;
  Layer layer{Layer::noteCards};
  Tone tone{Tone::neutral};
  std::uint32_t insertionOrder{0};
  ObjectId id{kInvalidObjectId};
  bool live{false};

  Bounds bounds() const { return {x, y, width, height}; }
};

// Flat-array rectangle document. Storage is one std::vector<Rectangle> reserved
// for 50,000 rectangles; removed objects free their slot for reuse without
// shrinking the reserved capacity. Draw order is a precomputed permutation of the
// live slots, so ordering a frame needs no per-object allocation and no map
// lookup; culling adds one hash lookup per visible grid cell (spatial.h). A
// Document is non-copyable and non-movable so its identity is unique: the spatial
// index binds to identity plus version and can never be applied to a different
// document that happens to share a version.
class Document {
 public:
  // The document caps the number of live rectangles at 50,000 (P2-02).
  static constexpr std::size_t kMaxRectangles = 50000;

  Document();
  ~Document() = default;
  Document(const Document&) = delete;
  Document& operator=(const Document&) = delete;
  Document(Document&&) = delete;
  Document& operator=(Document&&) = delete;

  // Clears the live objects; the reserved capacity stays (no per-frame
  // allocation). Object ids stay monotonic across a clear, so an id from the
  // cleared content is never reused.
  void clear();

  // Appends one live object and writes its stable id to `objectId`. Fails when
  // the document is full (50,000 live objects) or a coordinate is not finite or
  // overflows a double sum; a failure leaves the document untouched.
  Status addObject(Rectangle rectangle, ObjectId& objectId);

  // Compatibility wrapper for the board loader and the rectangle-only API: adds
  // the object and discards its id.
  Status addRectangle(Rectangle rectangle);

  // Adds the board's zones, blocks and cards as rectangles in their design
  // layers. Atomic: the whole board is validated (capacity and finite geometry)
  // before the document is mutated. Edges are not rectangles and are ignored.
  Status addBoardContent(const project_air::contracts::BoardContent& content);

  // Replaces the content with the packed rectangle records of the C ABI load
  // call (engine_load_rectangles): stride 6 per rectangle, x, y, width, height,
  // tone ordinal, layer ordinal. The complete array is validated before the
  // document is cleared, so a rejected load leaves the document (and a spatial
  // index built for it) unchanged. A successful load replaces every object and
  // invalidates every previous slot handle.
  Status loadPackedRectangles(const float* packed, int count);

  // Incremental mutations addressed by stable id. Each one validates its input
  // first, increments version() on success and leaves the document untouched on
  // failure (unknown or removed id, non-finite or overflowing geometry).
  Status updateGeometry(ObjectId objectId, double x, double y, double width, double height);
  Status updateZ(ObjectId objectId, std::string z);

  // Marks the object removed and frees its slot for a later insert; the id is
  // never reused. Removing an unknown or already removed id fails.
  Status removeObject(ObjectId objectId);

  // Maps a live object id to its storage index; unknown and removed ids fail.
  Status slotForId(ObjectId objectId, std::uint32_t& slot) const;

  const std::vector<Rectangle>& rectangles() const { return rectangles_; }

  // Number of live objects (removed slots excluded).
  std::size_t size() const { return liveCount_; }

  // Number of storage slots, including tombstones of removed objects.
  std::size_t slotCount() const { return rectangles_.size(); }

  bool isLive(std::uint32_t slot) const;

  // Stable draw order of the live objects: layer (design-rules §8), then
  // fractional z string (lexicographic), then insertion order; equal z keeps
  // insertion order. Removed objects never appear.
  const std::vector<std::uint32_t>& drawOrder() const;

  // Partial inverse of drawOrder(): drawOrderRank()[slot] is the slot's position
  // in the command buffer for a live object, and drawOrder().size() for a
  // tombstone. Reused by the renderer each frame.
  const std::vector<std::uint32_t>& drawOrderRank() const;

  // Increments on every mutation; the spatial index and command buffer compare it.
  std::uint32_t version() const { return version_; }

  // Unique identity of this document instance, assigned once and never reused in
  // the process. The spatial index compares it together with version().
  std::uint64_t instanceId() const { return instanceId_; }

 private:
  void rebuildDrawOrder() const;

  std::uint64_t instanceId_{0};
  std::uint64_t nextObjectId_{1};
  std::uint32_t nextInsertionOrder_{0};
  std::vector<Rectangle> rectangles_;
  std::vector<std::uint32_t> freeSlots_;
  std::unordered_map<ObjectId, std::uint32_t> slotsById_;
  std::size_t liveCount_{0};
  mutable std::vector<std::uint32_t> drawOrder_;
  mutable std::vector<std::uint32_t> drawOrderRank_;
  mutable bool drawOrderDirty_{false};
  std::uint32_t version_{0};
};

}  // namespace air::engine
