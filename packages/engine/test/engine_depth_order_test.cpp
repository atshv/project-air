// Native suite of the P6-15 depth-band ordering: the command buffer splits the
// draw order into bands so bound text can never paint over an object above it.
// The band rule is checked against the same L02 text boxes the binding pass
// draws, and against the camera-independence and determinism requirements.

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/render.h"
#include "engine/spatial.h"
#include "engine/status.h"
#include "engine/text_binding.h"
#include "test_support.h"
#include "tokens.h"

namespace {

using air::engine::Bounds;
using air::engine::Camera;
using air::engine::CommandBuffer;
using air::engine::Document;
using air::engine::DrawBand;
using air::engine::Instance;
using air::engine::Layer;
using air::engine::ObjectId;
using air::engine::ObjectTextBoxes;
using air::engine::objectTextBoxes;
using air::engine::Rectangle;
using air::engine::SpatialIndex;
using air::engine::Status;
using air::engine::Tone;

namespace test = air::engine::test;

Rectangle rectangle(Layer layer, double x, double y, double width, double height) {
  Rectangle value;
  value.x = x;
  value.y = y;
  value.width = width;
  value.height = height;
  value.layer = layer;
  value.tone = Tone::neutral;
  return value;
}

ObjectId add(Document& document, const Rectangle& value) {
  ObjectId id = air::engine::kInvalidObjectId;
  const Status status = document.addObject(value, id);
  test::expect(status.ok, "object added");
  return id;
}

Camera cameraAt(double panX, double panY, double zoom) {
  Camera camera;
  test::expect(camera.setView(panX, panY, zoom).ok, "camera view set");
  return camera;
}

// The world box of one object's bound text: header chrome and title for zones,
// band/title/preview for blocks, title and preview for cards. Mirrors the band
// planner's rule in render.cpp.
Bounds textBoundsOf(const Rectangle& value) {
  const ObjectTextBoxes boxes = objectTextBoxes(value);
  const Bounds* parts[4] = {nullptr, nullptr, nullptr, nullptr};
  std::size_t count = 0;
  if (value.layer == Layer::zones) {
    parts[0] = &boxes.band;
    parts[1] = &boxes.rule;
    parts[2] = &boxes.title;
    count = 3;
  } else if (value.layer == Layer::blocks) {
    parts[0] = &boxes.band;
    parts[1] = &boxes.rule;
    parts[2] = &boxes.title;
    parts[3] = &boxes.preview;
    count = 4;
  } else {
    parts[0] = &boxes.title;
    parts[1] = &boxes.preview;
    count = 2;
  }
  Bounds text{};
  bool any = false;
  for (std::size_t index = 0; index < count; ++index) {
    const Bounds* part = parts[index];
    if (!(part->width > 0.0) || !(part->height > 0.0)) {
      continue;
    }
    if (!any) {
      text = *part;
      any = true;
      continue;
    }
    const double left = text.x < part->x ? text.x : part->x;
    const double top = text.y < part->y ? text.y : part->y;
    const double right = text.right() > part->right() ? text.right() : part->right();
    const double bottom = text.bottom() > part->bottom() ? text.bottom() : part->bottom();
    text = Bounds{left, top, right - left, bottom - top};
  }
  return text;
}

std::vector<std::uint8_t> instanceBytes(const CommandBuffer& buffer) {
  std::vector<std::uint8_t> bytes(buffer.byteSize());
  if (!bytes.empty()) {
    std::memcpy(bytes.data(), buffer.bytes(), bytes.size());
  }
  return bytes;
}

void expectSingleBand(const CommandBuffer& buffer, std::size_t count,
                      std::string_view description) {
  test::expect(buffer.bands().size() == 1, description);
  if (buffer.bands().size() != 1) {
    return;
  }
  test::expect(buffer.bands()[0].count == count, "the single band holds every visible instance");
  test::expect(buffer.bands()[0].first == 0, "the single band starts at the first instance");
}

// A card whose title/preview boxes are covered by a later card must start a new
// depth band, so its text is drawn before the covering card.
void testCoveredTitleStartsANewBand() {
  test::section("a later card that covers an earlier title starts a new band");
  Document document;
  const ObjectId back = add(document, rectangle(Layer::noteCards, 64.0, 64.0, 240.0, 160.0));
  const ObjectId front = add(document, rectangle(Layer::noteCards, 120.0, 72.0, 160.0, 120.0));
  (void)front;
  SpatialIndex spatial;
  spatial.rebuild(document);

  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  CommandBuffer buffer;
  const Status status = buffer.build(document, camera, 1440.0, 900.0, spatial, true);
  test::expect(status.ok, "the banded build succeeds");
  test::expect(buffer.size() == 2, "both cards are visible");
  test::expect(buffer.bands().size() == 2, "the covered title forces two depth bands");
  if (buffer.bands().size() == 2) {
    const DrawBand& first = buffer.bands()[0];
    const DrawBand& second = buffer.bands()[1];
    test::expect(first.count == 1 && second.count == 1, "one card per band");
    test::expect(first.firstRank == 0 && second.firstRank == 1,
                 "bands follow document draw order");
    test::expect(first.lastRank == 0 && second.lastRank == 1,
                 "each band reports the visible rank range");
    test::expect(first.first == 0 && second.first == 1,
                 "band instance ranges are contiguous and in draw order");
  }

  // The invariant itself: inside a band no later object covers an earlier
  // object's bound text.
  const std::vector<std::uint32_t>& order = document.drawOrder();
  const std::vector<std::uint32_t>& rank = document.drawOrderRank();
  for (const DrawBand& band : buffer.bands()) {
    for (std::size_t left = 0; left < order.size(); ++left) {
      const std::uint32_t leftRank = rank[order[left]];
      if (leftRank < band.firstRank || leftRank > band.lastRank) {
        continue;
      }
      const Bounds text = textBoundsOf(document.rectangles()[order[left]]);
      for (std::size_t right = left + 1; right < order.size(); ++right) {
        const std::uint32_t rightRank = rank[order[right]];
        if (rightRank < band.firstRank || rightRank > band.lastRank) {
          continue;
        }
        const bool covered = text.intersects(document.rectangles()[order[right]].bounds());
        test::expect(!covered, "no later object of a band covers an earlier object's text");
      }
    }
  }
  (void)back;
}

// A board without covered text keeps one band, so the common board still draws
// in one instanced call.
void testUncoveredObjectsKeepOneBand() {
  test::section("objects that do not cover earlier text stay in one band");
  Document document;
  add(document, rectangle(Layer::noteCards, 64.0, 64.0, 240.0, 160.0));
  add(document, rectangle(Layer::noteCards, 400.0, 64.0, 240.0, 160.0));
  add(document, rectangle(Layer::noteCards, 64.0, 400.0, 240.0, 160.0));
  SpatialIndex spatial;
  spatial.rebuild(document);

  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  CommandBuffer buffer;
  test::expect(buffer.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the banded build succeeds");
  expectSingleBand(buffer, 3, "non-overlapping cards keep one band");
}

// A zone's title lives in its 40 px header; members inside the content area must
// not split the band off, or a full board would draw one band per object.
void testZoneMembersKeepOneBand() {
  test::section("zone members below the header keep the zone's band");
  Document document;
  add(document, rectangle(Layer::zones, 32.0, 32.0, 448.0, 368.0));
  add(document, rectangle(Layer::noteCards, 64.0, 96.0, 160.0, 96.0));
  add(document, rectangle(Layer::blocks, 256.0, 96.0, 160.0, 96.0));
  SpatialIndex spatial;
  spatial.rebuild(document);

  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  CommandBuffer buffer;
  test::expect(buffer.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the banded build succeeds");
  expectSingleBand(buffer, 3, "a zone and its content members keep one band");
}

// A card that covers a zone's header does cover the zone title, so the zone text
// must be drawn first.
void testCardOverZoneHeaderSplits() {
  test::section("a card over the zone header splits the band before the card");
  Document document;
  add(document, rectangle(Layer::zones, 32.0, 32.0, 448.0, 368.0));
  add(document, rectangle(Layer::noteCards, 40.0, 40.0, 160.0, 96.0));
  SpatialIndex spatial;
  spatial.rebuild(document);

  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  CommandBuffer buffer;
  test::expect(buffer.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the banded build succeeds");
  test::expect(buffer.bands().size() == 2, "the covered zone header splits the band");
}

// The band split is formed in document space: panning and zooming may change the
// visible set but never the split of the objects that remain visible.
void testBandPlanIsCameraIndependent() {
  test::section("the band split does not depend on the camera");
  Document document;
  add(document, rectangle(Layer::noteCards, 64.0, 64.0, 240.0, 160.0));
  add(document, rectangle(Layer::noteCards, 400.0, 64.0, 240.0, 160.0));
  add(document, rectangle(Layer::noteCards, 120.0, 72.0, 160.0, 120.0));
  SpatialIndex spatial;
  spatial.rebuild(document);

  CommandBuffer buffer;
  test::expect(buffer.build(document, cameraAt(0.0, 0.0, 1.0), 1440.0, 900.0, spatial, true).ok,
               "the first camera builds");
  const std::vector<DrawBand> first = buffer.bands();
  test::expect(first.size() == 2, "the covered title still splits under the first camera");
  test::expect(buffer.build(document, cameraAt(10.0, 5.0, 0.75), 1440.0, 900.0, spatial, true).ok,
               "the second camera builds");
  const std::vector<DrawBand> second = buffer.bands();
  test::expect(first.size() == second.size(), "the band count is camera-independent");
  if (first.size() == second.size()) {
    for (std::size_t index = 0; index < first.size(); ++index) {
      test::expect(first[index].firstRank == second[index].firstRank,
                   "band start ranks are camera-independent");
      test::expect(first[index].lastRank == second[index].lastRank,
                   "band end ranks are camera-independent");
    }
  }
}

// Without `interleave` the build is exactly the P4-03 draw: one band and the same
// instance bytes.
void testLegacyBuildKeepsOneBand() {
  test::section("the legacy build keeps one band and the same instance bytes");
  Document document;
  add(document, rectangle(Layer::noteCards, 64.0, 64.0, 240.0, 160.0));
  add(document, rectangle(Layer::noteCards, 120.0, 72.0, 160.0, 120.0));
  SpatialIndex spatial;
  spatial.rebuild(document);
  const Camera camera = cameraAt(0.0, 0.0, 1.0);

  CommandBuffer legacy;
  test::expect(legacy.build(document, camera, 1440.0, 900.0, spatial).ok,
               "the legacy build succeeds");
  expectSingleBand(legacy, 2, "the legacy build is one band");
  const std::vector<std::uint8_t> legacyBytes = instanceBytes(legacy);

  CommandBuffer banded;
  test::expect(banded.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the banded build succeeds");
  test::expect(banded.size() == legacy.size(), "banding does not change the instance count");
  test::expect(instanceBytes(banded) == legacyBytes,
               "banding does not change the instance records");
}

// The plan is rebuilt when the document changes: moving the front card away
// merges the bands again.
void testBandPlanFollowsDocumentChanges() {
  test::section("the band plan follows a document change");
  Document document;
  add(document, rectangle(Layer::noteCards, 64.0, 64.0, 240.0, 160.0));
  const ObjectId front =
      add(document, rectangle(Layer::noteCards, 120.0, 72.0, 160.0, 120.0));
  SpatialIndex spatial;
  spatial.rebuild(document);
  const Camera camera = cameraAt(0.0, 0.0, 1.0);

  CommandBuffer buffer;
  test::expect(buffer.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the first build succeeds");
  test::expect(buffer.bands().size() == 2, "the overlap splits the band");

  test::expect(document.updateGeometry(front, 400.0, 400.0, 160.0, 120.0).ok,
               "the front card moves away");
  spatial.updateSlot(document, static_cast<std::uint32_t>(1));
  test::expect(buffer.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the rebuilt build succeeds");
  expectSingleBand(buffer, 2, "moving the card away merges the bands again");
}

// A full engine-core-sized board (10,000 objects: 200 zone containers, three
// blocks and 46 cards each) keeps one band, because every member starts below the
// 40 px zone header: a text-bound frame of that board pays no band draw calls.
void testLargeBoardKeepsOneBand() {
  test::section("a 10,000-object container board keeps one band");
  Document document;
  constexpr int kZoneColumns = 20;
  constexpr int kZoneRows = 10;
  constexpr double kCellWidth = 960.0;
  constexpr double kCellHeight = 1056.0;
  constexpr double kZoneInset = 32.0;
  constexpr double kContentTop = 160.0;
  for (int row = 0; row < kZoneRows; ++row) {
    for (int column = 0; column < kZoneColumns; ++column) {
      const double zoneX = column * kCellWidth + kZoneInset;
      const double zoneY = row * kCellHeight + kZoneInset;
      add(document, rectangle(Layer::zones, zoneX, zoneY, kCellWidth - 2.0 * kZoneInset,
                              kCellHeight - 2.0 * kZoneInset));
      for (int block = 0; block < 3; ++block) {
        add(document, rectangle(Layer::blocks, zoneX + 16.0 + block * 296.0,
                                zoneY + kContentTop, 280.0, 96.0));
      }
      int cards = 0;
      for (int cardRow = 0; cardRow < 7 && cards < 46; ++cardRow) {
        for (int cardColumn = 0; cardColumn < 7 && cards < 46; ++cardColumn) {
          add(document, rectangle(Layer::noteCards, zoneX + 16.0 + cardColumn * 96.0,
                                  zoneY + kContentTop + 112.0 + cardRow * 88.0, 88.0, 80.0));
          cards += 1;
        }
      }
    }
  }
  test::expect(document.size() == 10000, "the board holds 10,000 objects");
  SpatialIndex spatial;
  spatial.rebuild(document);
  CommandBuffer buffer;
  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  test::expect(buffer.build(document, camera, 640.0, 480.0, spatial, true).ok,
               "the banded build of the full board succeeds");
  test::expect(!buffer.bands().empty(), "the full board is visible");
  test::expect(buffer.bands().size() == 1, "the full container board keeps one band");
}

// Determinism: identical input gives identical bands and bytes.
void testBandBuildIsDeterministic() {
  test::section("the banded build is deterministic");
  Document document;
  add(document, rectangle(Layer::noteCards, 64.0, 64.0, 240.0, 160.0));
  add(document, rectangle(Layer::noteCards, 120.0, 72.0, 160.0, 120.0));
  add(document, rectangle(Layer::noteCards, 800.0, 64.0, 240.0, 160.0));
  SpatialIndex spatial;
  spatial.rebuild(document);
  const Camera camera = cameraAt(0.0, 0.0, 1.0);

  CommandBuffer first;
  CommandBuffer second;
  test::expect(first.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the first build succeeds");
  test::expect(second.build(document, camera, 1440.0, 900.0, spatial, true).ok,
               "the second build succeeds");
  test::expect(first.bands().size() == second.bands().size(), "identical band counts");
  test::expect(instanceBytes(first) == instanceBytes(second), "identical instance bytes");
  for (std::size_t index = 0; index < first.bands().size() && index < second.bands().size();
       ++index) {
    test::expect(first.bands()[index].first == second.bands()[index].first,
                 "identical band instance ranges");
    test::expect(first.bands()[index].firstRank == second.bands()[index].firstRank,
                 "identical band rank ranges");
  }
}

// A stale spatial index fails closed and leaves no bands behind.
void testStaleIndexFailsClosed() {
  test::section("a stale spatial index fails the banded build closed");
  Document document;
  add(document, rectangle(Layer::noteCards, 64.0, 64.0, 240.0, 160.0));
  SpatialIndex empty;
  CommandBuffer buffer;
  const Status status = buffer.build(document, cameraAt(0.0, 0.0, 1.0), 1440.0, 900.0, empty,
                                     true);
  test::expect(!status.ok, "a stale index is rejected");
  test::expect(buffer.bands().empty(), "a failed build leaves no bands");
}

}  // namespace

int main() {
  testCoveredTitleStartsANewBand();
  testUncoveredObjectsKeepOneBand();
  testZoneMembersKeepOneBand();
  testCardOverZoneHeaderSplits();
  testBandPlanIsCameraIndependent();
  testLegacyBuildKeepsOneBand();
  testBandPlanFollowsDocumentChanges();
  testLargeBoardKeepsOneBand();
  testBandBuildIsDeterministic();
  testStaleIndexFailsClosed();
  if (test::failures != 0) {
    std::fprintf(stderr, "%d failure(s)\n", test::failures);
    return 1;
  }
  std::printf("depth-order tests passed\n");
  return 0;
}
