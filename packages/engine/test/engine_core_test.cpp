#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "contract.h"
#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/render.h"
#include "engine/spatial.h"
#include "engine/status.h"
#include "test_support.h"
#include "tokens.h"

namespace {

using air::engine::Bounds;
using air::engine::Camera;
using air::engine::CommandBuffer;
using air::engine::Document;
using air::engine::Instance;
using air::engine::Layer;
using air::engine::Point;
using air::engine::Rectangle;
using air::engine::SpatialIndex;
using air::engine::Status;
using air::engine::Tone;
using air::engine::toneColor;

namespace test = air::engine::test;

constexpr std::uint32_t kColumnCount = 200;

Rectangle makeRectangle(double x, double y, double width, double height, std::string z,
                        Layer layer = Layer::noteCards, Tone tone = Tone::neutral) {
  Rectangle rectangle;
  rectangle.x = x;
  rectangle.y = y;
  rectangle.width = width;
  rectangle.height = height;
  rectangle.z = std::move(z);
  rectangle.layer = layer;
  rectangle.tone = tone;
  return rectangle;
}

void addRectangle(Document& document, const Rectangle& rectangle) {
  const Status status = document.addRectangle(rectangle);
  test::expect(status.ok, "addRectangle succeeds");
}

Layer layerForIndex(std::size_t index) {
  switch (index % 3U) {
    case 0:
      return Layer::zones;
    case 1:
      return Layer::blocks;
    default:
      return Layer::noteCards;
  }
}

Tone toneForIndex(std::size_t index) {
  switch (index % 6U) {
    case 0:
      return Tone::neutral;
    case 1:
      return Tone::toneA;
    case 2:
      return Tone::toneB;
    case 3:
      return Tone::toneC;
    case 4:
      return Tone::toneD;
    default:
      return Tone::toneE;
  }
}

void fillFiftyThousandRectangles(Document& document) {
  for (std::size_t index = 0; index < Document::kMaxRectangles; ++index) {
    const std::uint32_t column = static_cast<std::uint32_t>(index % kColumnCount);
    const std::uint32_t row = static_cast<std::uint32_t>(index / kColumnCount);
    const double spacing = 40.0;
    addRectangle(document, makeRectangle(static_cast<double>(column) * spacing,
                                         static_cast<double>(row) * spacing, 32.0, 20.0,
                                         test::fracKey(static_cast<std::uint32_t>(index)),
                                         layerForIndex(index), toneForIndex(index)));
    if (document.size() != index + 1) {
      return;
    }
  }
}

void cameraRoundTrip() {
  test::section("camera round-trip and bounds");
  Camera camera;
  camera.setPan(123.5, -456.25);
  camera.setZoom(2.5);

  const Point points[] = {{0.0, 0.0}, {100.0, 200.0}, {-50.5, 75.25}, {4096.0, -8192.0}};
  for (const Point& point : points) {
    const Point roundTrip = camera.screenToWorld(camera.worldToScreen(point));
    const double tolerance = 1e-9 * (std::abs(point.x) + std::abs(point.y) + 1.0);
    test::expectNear(roundTrip.x, point.x, tolerance, "world->screen->world x round-trips");
    test::expectNear(roundTrip.y, point.y, tolerance, "world->screen->world y round-trips");
  }

  camera.setPan(100.0, 200.0);
  camera.setZoom(2.0);
  const Bounds visible = camera.visibleWorldBounds(800.0, 600.0);
  test::expectNear(visible.x, 100.0, 0.0, "visible bounds start at the pan x");
  test::expectNear(visible.y, 200.0, 0.0, "visible bounds start at the pan y");
  test::expectNear(visible.width, 400.0, 0.0, "visible bounds width is viewport / zoom");
  test::expectNear(visible.height, 300.0, 0.0, "visible bounds height is viewport / zoom");
  test::expect(visible.contains({250.0, 350.0}), "a point inside the viewport is contained");
  test::expect(!visible.contains({99.0, 350.0}), "a point outside the viewport is not contained");

  const Point screen = camera.worldToScreen({250.0, 350.0});
  test::expectNear(screen.x, 300.0, 0.0, "world->screen x follows the camera convention");
  test::expectNear(screen.y, 300.0, 0.0, "world->screen y follows the camera convention");
}

void cameraZoomAndGrid() {
  test::section("camera zoom limits, panning and the token grid");
  Camera camera;
  camera.setZoom(0.001);
  test::expectNear(camera.zoom(), Camera::kMinZoom, 0.0, "zoom clamps to the minimum");
  camera.setZoom(1.0e9);
  test::expectNear(camera.zoom(), Camera::kMaxZoom, 0.0, "zoom clamps to the maximum");
  camera.setZoom(std::numeric_limits<double>::quiet_NaN());
  test::expectNear(camera.zoom(), Camera::kMaxZoom, 0.0,
                   "a rejected non-finite zoom keeps the current zoom");

  for (const double zoom : {Camera::kMinZoom, 1.0, Camera::kMaxZoom}) {
    camera.setPan(-2.0e6, 3.0e6);
    camera.setZoom(zoom);
    const Point point = {1.0e6, -1.0e6};
    const Point roundTrip = camera.screenToWorld(camera.worldToScreen(point));
    test::expectNear(roundTrip.x, point.x, 1e-5, "extreme zoom keeps the x round-trip stable");
    test::expectNear(roundTrip.y, point.y, 1e-5, "extreme zoom keeps the y round-trip stable");
  }

  camera.setPan(0.0, 0.0);
  camera.setZoom(2.0);
  camera.panByScreen(20.0, 10.0);
  test::expectNear(camera.panX(), -10.0, 0.0, "panByScreen moves pan against the drag in x");
  test::expectNear(camera.panY(), -5.0, 0.0, "panByScreen moves pan against the drag in y");

  test::expectNear(Camera::gridSize(), tokens::canvas_grid, 0.0,
                   "the camera grid is the ui-kit canvas grid token");
  test::expectNear(Camera::gridSize(), 16.0, 0.0, "the canvas grid is 16 px");
  test::expectNear(Camera::snapToGrid(23.0), 16.0, 0.0, "snapToGrid rounds 23 to 16");
  test::expectNear(Camera::snapToGrid(25.0), 32.0, 0.0, "snapToGrid rounds 25 to 32");
  test::expectNear(Camera::snapToGrid(-9.0), -16.0, 0.0, "snapToGrid rounds -9 to -16");
}

void cameraValidation() {
  test::section("camera rejects non-finite input instead of propagating UB");
  Camera camera;
  camera.setPan(10.0, 20.0);
  camera.setZoom(3.0);

  Status status = camera.setPan(std::numeric_limits<double>::quiet_NaN(), 0.0);
  test::expect(!status.ok && status.reason != nullptr, "a NaN pan x is rejected with a reason");
  test::expectNear(camera.panX(), 10.0, 0.0, "a rejected pan keeps the previous x");

  status = camera.setPan(0.0, std::numeric_limits<double>::infinity());
  test::expect(!status.ok, "an infinite pan y is rejected");
  test::expectNear(camera.panY(), 20.0, 0.0, "a rejected pan keeps the previous y");

  status = camera.setZoom(std::numeric_limits<double>::quiet_NaN());
  test::expect(!status.ok, "a NaN zoom is rejected");
  test::expectNear(camera.zoom(), 3.0, 0.0, "a rejected zoom keeps the previous zoom");

  status = camera.panByScreen(std::numeric_limits<double>::infinity(), 0.0);
  test::expect(!status.ok, "an infinite drag delta is rejected");
  test::expectNear(camera.panX(), 10.0, 0.0, "a rejected drag keeps the pan");

  status = camera.setZoom(1.0e9);
  test::expect(status.ok, "a finite zoom is still accepted");
  test::expectNear(camera.zoom(), Camera::kMaxZoom, 0.0, "a finite zoom still clamps");
}

void cullingAndDrawOrder() {
  test::section("culling keeps exactly the visible rectangles in stable order");
  Document document;
  addRectangle(document, makeRectangle(10.0, 10.0, 10.0, 10.0, "z", Layer::blocks, Tone::toneB));
  addRectangle(document, makeRectangle(20.0, 20.0, 10.0, 10.0, "a", Layer::noteCards, Tone::toneA));
  addRectangle(document, makeRectangle(30.0, 30.0, 10.0, 10.0, "a", Layer::noteCards, Tone::toneC));
  addRectangle(document, makeRectangle(40.0, 40.0, 10.0, 10.0, "b", Layer::noteCards, Tone::toneD));
  addRectangle(document, makeRectangle(1000.0, 1000.0, 10.0, 10.0, "0", Layer::noteCards,
                                       Tone::toneE));
  addRectangle(document, makeRectangle(95.0, 95.0, 20.0, 20.0, "c", Layer::noteCards));

  Camera camera;
  SpatialIndex spatial;
  spatial.rebuild(document);
  CommandBuffer buffer;
  const Status status = buffer.build(document, camera, 100.0, 100.0, spatial);
  test::expect(status.ok, "the command buffer build succeeds");
  test::expect(buffer.size() == 5, "culling drops the rectangle outside the viewport");
  if (buffer.size() == 5) {
    const std::vector<Instance>& instances = buffer.instances();
    test::expectNear(instances[0].x, 10.0, 0.0, "the blocks layer draws before note cards");
    test::expect(instances[0].layer == static_cast<std::uint32_t>(Layer::blocks),
                 "the instance carries the design layer");
    test::expectNear(instances[1].x, 20.0, 0.0, "equal z keeps insertion order (first)");
    test::expectNear(instances[2].x, 30.0, 0.0, "equal z keeps insertion order (second)");
    test::expectNear(instances[3].x, 40.0, 0.0, "the fractional z string orders the next card");
    test::expectNear(instances[4].x, 95.0, 0.0, "a partially visible rectangle is kept");
    test::expectNear(instances[4].width, 20.0, 0.0, "the screen quad keeps the world size at zoom 1");
    test::expect(instances[1].tone == static_cast<std::uint32_t>(Tone::toneA),
                 "the instance keeps the tone reference");
  }
}

void edgeCases() {
  test::section("empty document, single rectangle, camera outside the content");
  Camera camera;
  SpatialIndex spatial;
  CommandBuffer buffer;

  Document empty;
  spatial.rebuild(empty);
  Status status = buffer.build(empty, camera, 100.0, 100.0, spatial);
  test::expect(status.ok, "the empty document builds");
  test::expect(buffer.empty(), "the empty document has no instances");
  test::expect(buffer.byteSize() == 0, "the empty document has no bytes");
  test::expect(buffer.bytes() == nullptr, "the empty document has no record pointer");

  Document single;
  addRectangle(single, makeRectangle(10.0, 10.0, 10.0, 10.0, "a", Layer::blocks, Tone::toneB));
  spatial.rebuild(single);
  camera.setPan(5.0, 5.0);
  camera.setZoom(2.0);
  status = buffer.build(single, camera, 100.0, 100.0, spatial);
  test::expect(status.ok && buffer.size() == 1, "a single rectangle produces one instance");
  if (buffer.size() == 1) {
    const Instance& instance = buffer.instances()[0];
    test::expectNear(instance.x, 10.0, 1e-9, "the screen quad x follows the camera");
    test::expectNear(instance.y, 10.0, 1e-9, "the screen quad y follows the camera");
    test::expectNear(instance.width, 20.0, 1e-9, "the screen quad width follows the zoom");
    test::expectNear(instance.height, 20.0, 1e-9, "the screen quad height follows the zoom");
  }

  Document outside;
  addRectangle(outside, makeRectangle(5000.0, 5000.0, 10.0, 10.0, "a"));
  spatial.rebuild(outside);
  camera.setPan(0.0, 0.0);
  camera.setZoom(1.0);
  status = buffer.build(outside, camera, 100.0, 100.0, spatial);
  test::expect(status.ok && buffer.empty(), "a document outside the viewport yields an empty buffer");
  camera.setPan(1.0e6, 1.0e6);
  status = buffer.build(outside, camera, 100.0, 100.0, spatial);
  test::expect(status.ok && buffer.empty(), "a camera far outside the content yields an empty buffer");

  Document overlapping;
  addRectangle(overlapping, makeRectangle(0.0, 0.0, 50.0, 50.0, "a"));
  addRectangle(overlapping, makeRectangle(25.0, 25.0, 50.0, 50.0, "a"));
  spatial.rebuild(overlapping);
  camera.setPan(0.0, 0.0);
  status = buffer.build(overlapping, camera, 100.0, 100.0, spatial);
  test::expect(status.ok && buffer.size() == 2, "overlapping rectangles are both drawn");
}

void crossDocumentStaleIndex() {
  test::section("a spatial index never matches a foreign document");
  Document source;
  for (int index = 0; index < 5; ++index) {
    addRectangle(source,
                 makeRectangle(static_cast<double>(index) * 40.0, 0.0, 10.0, 10.0, "a"));
  }
  SpatialIndex spatial;
  spatial.rebuild(source);
  test::expect(spatial.isCurrent(source), "the index is current for the document it was built from");

  // Same rectangle count and Document version, different content: before the
  // identity binding the old cells were silently applied and rectangles dropped.
  Document sameSize;
  for (int index = 0; index < 5; ++index) {
    addRectangle(sameSize, makeRectangle(1000.0 + static_cast<double>(index) * 40.0, 1000.0, 10.0,
                                         10.0, "a"));
  }
  test::expect(sameSize.instanceId() != source.instanceId(),
               "two documents have distinct identities");
  test::expect(sameSize.version() == source.version() && sameSize.size() == source.size(),
               "the two documents share version and size");
  test::expect(!spatial.isCurrent(sameSize), "the index is not current for another document");
  Camera camera;
  CommandBuffer buffer;
  Status status = buffer.build(sameSize, camera, 100.0, 100.0, spatial);
  test::expect(!status.ok && status.reason != nullptr,
               "an index for another document is rejected instead of silently applied");
  test::expect(buffer.empty(), "the rejected build leaves no instances");

  // Same version, smaller document: before the fix the foreign indices indexed
  // out of bounds (ASan container-overflow).
  Document smaller;
  addRectangle(smaller, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  addRectangle(smaller, makeRectangle(10.0, 0.0, 10.0, 10.0, "a"));
  addRectangle(smaller, makeRectangle(20.0, 0.0, 10.0, 10.0, "a"));
  smaller.clear();
  addRectangle(smaller, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  test::expect(smaller.version() == source.version() && smaller.size() == 1,
               "the smaller document also shares the version");
  status = buffer.build(smaller, camera, 100.0, 100.0, spatial);
  test::expect(!status.ok && buffer.empty(),
               "an index from a larger same-version document is rejected before indexing");

  spatial.rebuild(smaller);
  status = buffer.build(smaller, camera, 100.0, 100.0, spatial);
  test::expect(status.ok && buffer.size() == 1,
               "after rebuild the index works for its own document");
}

void boardContentRejection() {
  test::section("board content is validated and rejected atomically");
  Document document;
  test::expect(document.version() == 0, "a new document starts at version 0");

  // A 50,001-card board used to underflow the size_t capacity guard, append
  // 50,000 rectangles and report the wrong reason.
  project_air::contracts::BoardContent tooMany{};
  tooMany.cards.resize(50001);
  Status status = document.addBoardContent(tooMany);
  test::expect(!status.ok && status.reason != nullptr, "a board with 50,001 cards is rejected");
  if (status.reason != nullptr) {
    test::expect(std::string_view(status.reason).find("exceeds") != std::string_view::npos,
                 "the rejection reports the capacity limit, not 'document is full'");
  }
  test::expect(document.size() == 0 && document.version() == 0,
               "the oversized board leaves the document untouched");

  // A non-finite width in a later entity used to abort after earlier entities
  // had already been appended.
  project_air::contracts::BoardContent invalid{};
  project_air::contracts::Card good{};
  good.x = 1.0;
  good.y = 2.0;
  good.width = 10.0;
  good.height = 20.0;
  good.z = "a0";
  project_air::contracts::Card bad = good;
  bad.width = std::numeric_limits<double>::quiet_NaN();
  invalid.cards.push_back(good);
  invalid.cards.push_back(bad);
  status = document.addBoardContent(invalid);
  test::expect(!status.ok && status.reason != nullptr,
               "a non-finite width is rejected with a reason");
  test::expect(document.size() == 0 && document.version() == 0,
               "the invalid board leaves the document untouched");
}

void largeCoordinates() {
  test::section("very large and non-finite coordinates stay clamped");
  Document document;
  addRectangle(document, makeRectangle(1.0e12, -1.0e12, 10.0, 10.0, "a"));
  SpatialIndex spatial;
  spatial.rebuild(document);
  Camera camera;
  const Status panStatus = camera.setPan(1.0e12, -1.0e12);
  test::expect(panStatus.ok, "a very large finite pan is accepted");
  CommandBuffer buffer;
  Status status = buffer.build(document, camera, 100.0, 100.0, spatial);
  test::expect(status.ok, "the command buffer builds at huge world coordinates");
  test::expect(buffer.size() == 1, "the rectangle at 1e12 is visible through the camera");
  if (buffer.size() == 1) {
    const Instance& instance = buffer.instances()[0];
    test::expect(std::isfinite(instance.x) && std::isfinite(instance.y) &&
                     std::isfinite(instance.width) && std::isfinite(instance.height),
                 "the screen quad stays finite at huge coordinates");
    test::expectNear(instance.x, 0.0, 1e-6, "the rectangle maps to the screen origin");
  }
  std::vector<std::uint32_t> candidates;
  spatial.query({std::numeric_limits<double>::quiet_NaN(), 0.0, 1.0, 1.0}, candidates);
  test::expect(candidates.empty(), "a non-finite query bound is clamped instead of UB");
}

void determinismAndPerformance() {
  test::section("determinism and performance on 50,000 rectangles");
  Document document;
  fillFiftyThousandRectangles(document);
  test::expect(document.size() == Document::kMaxRectangles,
               "the document holds 50,000 rectangles");

  Camera camera;
  SpatialIndex spatial;
  spatial.rebuild(document);

  CommandBuffer first;
  Status status = first.build(document, camera, 8000.0, 10000.0, spatial);
  test::expect(status.ok && first.size() == 50000,
               "all 50,000 rectangles are in the command buffer");
  std::vector<std::uint8_t> bytes;
  if (status.ok && first.byteSize() > 0) {
    bytes.assign(first.bytes(), first.bytes() + first.byteSize());
  }
  test::expect(!bytes.empty(), "the first build produced record bytes");

  CommandBuffer second;
  status = second.build(document, camera, 8000.0, 10000.0, spatial);
  test::expect(status.ok, "the second build succeeds");
  test::expect(second.byteSize() == bytes.size(), "two builds have the same byte size");
  test::expect(!bytes.empty() && second.byteSize() == bytes.size() &&
                   std::memcmp(second.bytes(), bytes.data(), bytes.size()) == 0,
               "two builds of the same document are byte-identical");

  status = first.build(document, camera, 8000.0, 10000.0, spatial);
  test::expect(status.ok && !bytes.empty() && first.byteSize() == bytes.size() &&
                   std::memcmp(first.bytes(), bytes.data(), bytes.size()) == 0,
               "rebuilding the same command buffer is byte-identical");

  status = first.build(document, camera, 8000.0, 10000.0, spatial);
  const auto start = std::chrono::steady_clock::now();
  status = first.build(document, camera, 8000.0, 10000.0, spatial);
  const auto end = std::chrono::steady_clock::now();
  const double elapsedMilliseconds =
      std::chrono::duration<double, std::milli>(end - start).count();
  std::printf("  50,000-rectangle native command buffer: %.3f ms (bound 100 ms)\n",
              elapsedMilliseconds);
  test::expect(status.ok, "the measured build succeeds");
  test::expect(elapsedMilliseconds < 100.0,
               "one 50,000-rectangle command buffer builds within the 100 ms bound");
}

void staleIndexAndCapacity() {
  test::section("stale spatial index and the document capacity");
  Document document;
  addRectangle(document, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  SpatialIndex spatial;
  spatial.rebuild(document);
  addRectangle(document, makeRectangle(20.0, 20.0, 10.0, 10.0, "b"));

  Camera camera;
  CommandBuffer buffer;
  Status status = buffer.build(document, camera, 100.0, 100.0, spatial);
  test::expect(!status.ok && status.reason != nullptr,
               "a stale spatial index is reported instead of silently skipped");
  test::expect(buffer.empty(), "the stale-index failure leaves an empty buffer");
  test::expect(buffer.bytes() == nullptr, "the failed build has no record pointer");
  spatial.rebuild(document);
  status = buffer.build(document, camera, 100.0, 100.0, spatial);
  test::expect(status.ok && buffer.size() == 2, "rebuilding the index unblocks the buffer");

  Document full;
  fillFiftyThousandRectangles(full);
  const Status overflow = full.addRectangle(makeRectangle(0.0, 0.0, 1.0, 1.0, "z"));
  test::expect(!overflow.ok && overflow.reason != nullptr,
               "the 50,001st rectangle is rejected with a reason");
  if (overflow.reason != nullptr) {
    test::expect(std::string_view(overflow.reason).find("full") != std::string_view::npos,
                 "the capacity reason says the document is full");
  }
}

void tonesAndContract() {
  test::section("tone and layer tokens plus contract integration");
  test::expect(static_cast<int>(Layer::zones) == tokens::layer_zones,
               "the zones layer uses the token z-index");
  test::expect(static_cast<int>(Layer::blocks) == tokens::layer_blocks,
               "the blocks layer uses the token z-index");
  test::expect(static_cast<int>(Layer::noteCards) == tokens::layer_note_cards,
               "the note-card layer uses the token z-index");
  test::expect(std::string_view(toneColor(Tone::neutral)) == std::string_view(tokens::card),
               "the neutral tone resolves to the card token");
  test::expect(std::string_view(toneColor(Tone::toneA)) == std::string_view(tokens::tone_a),
               "tone A resolves to token tone_a");
  test::expect(std::string_view(toneColor(Tone::toneB)) == std::string_view(tokens::tone_b),
               "tone B resolves to token tone_b");
  test::expect(std::string_view(toneColor(Tone::toneC)) == std::string_view(tokens::tone_c),
               "tone C resolves to token tone_c");
  test::expect(std::string_view(toneColor(Tone::toneD)) == std::string_view(tokens::tone_d),
               "tone D resolves to token tone_d");
  test::expect(std::string_view(toneColor(Tone::toneE)) == std::string_view(tokens::tone_e),
               "tone E resolves to token tone_e");

  test::expect(std::string_view(project_air::contracts::kContractVersion) == "0.1.0",
               "the generated contract is version 0.1.0");

  project_air::contracts::BoardContent content{};
  project_air::contracts::Zone zone{};
  zone.x = 0.0;
  zone.y = 0.0;
  zone.width = 100.0;
  zone.height = 100.0;
  zone.z = "a0";
  content.zones.push_back(zone);
  project_air::contracts::Block block{};
  block.x = 10.0;
  block.y = 10.0;
  block.width = 100.0;
  block.height = 100.0;
  block.z = "a1";
  content.blocks.push_back(block);
  project_air::contracts::Card card{};
  card.x = 20.0;
  card.y = 20.0;
  card.width = 100.0;
  card.height = 100.0;
  card.z = "a2";
  content.cards.push_back(card);

  Document document;
  const Status status = document.addBoardContent(content);
  test::expect(status.ok && document.size() == 3, "board content becomes flat rectangles");
  const std::vector<std::uint32_t>& order = document.drawOrder();
  if (order.size() == 3) {
    const std::vector<Rectangle>& rectangles = document.rectangles();
    test::expect(rectangles[order[0]].layer == Layer::zones, "zones draw at the bottom layer");
    test::expect(rectangles[order[1]].layer == Layer::blocks, "blocks draw above zones");
    test::expect(rectangles[order[2]].layer == Layer::noteCards, "note cards draw above blocks");
  }

  Document ties;
  addRectangle(ties, makeRectangle(0.0, 0.0, 1.0, 1.0, "a"));
  addRectangle(ties, makeRectangle(0.0, 0.0, 1.0, 1.0, "a"));
  addRectangle(ties, makeRectangle(0.0, 0.0, 1.0, 1.0, "a"));
  const std::vector<std::uint32_t> expected = {0, 1, 2};
  test::expect(ties.drawOrder() == expected, "equal z and layer keep insertion order");
}

}  // namespace

int main() {
  std::printf("engine_core_tests\n");
  cameraRoundTrip();
  cameraZoomAndGrid();
  cameraValidation();
  cullingAndDrawOrder();
  edgeCases();
  crossDocumentStaleIndex();
  boardContentRejection();
  largeCoordinates();
  determinismAndPerformance();
  staleIndexAndCapacity();
  tonesAndContract();

  if (test::failures != 0) {
    std::fprintf(stderr, "engine_core_tests: %d check(s) failed\n", test::failures);
    return 1;
  }
  std::puts("engine_core_tests: all checks passed");
  return 0;
}
