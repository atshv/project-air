#include <algorithm>
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
using air::engine::HitResult;
using air::engine::Instance;
using air::engine::kInvalidObjectId;
using air::engine::kNoObject;
using air::engine::Layer;
using air::engine::ObjectId;
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

ObjectId addObjectWithId(Document& document, Rectangle rectangle) {
  ObjectId objectId = kInvalidObjectId;
  const Status status = document.addObject(std::move(rectangle), objectId);
  test::expect(status.ok && objectId != kInvalidObjectId, "addObject succeeds with a stable id");
  return objectId;
}

std::uint32_t slotOf(const Document& document, ObjectId objectId) {
  std::uint32_t slot = 0;
  const Status status = document.slotForId(objectId, slot);
  test::expect(status.ok, "a live object id resolves to its slot");
  return slot;
}

std::vector<std::uint8_t> captureBytes(CommandBuffer& buffer, const Document& document,
                                       const Camera& camera, const SpatialIndex& spatial) {
  const Status status = buffer.build(document, camera, 800.0, 600.0, spatial);
  test::expect(status.ok, "the command buffer build succeeds");
  std::vector<std::uint8_t> bytes;
  if (status.ok && buffer.byteSize() > 0) {
    bytes.assign(buffer.bytes(), buffer.bytes() + buffer.byteSize());
  }
  return bytes;
}

void expectSameBytes(const std::vector<std::uint8_t>& actual,
                     const std::vector<std::uint8_t>& expected, std::string_view description) {
  test::expect(actual.size() == expected.size() &&
                   (actual.empty() ||
                    std::memcmp(actual.data(), expected.data(), actual.size()) == 0),
               description);
}

bool candidatesContain(const std::vector<std::uint32_t>& candidates, std::uint32_t slot) {
  return std::find(candidates.begin(), candidates.end(), slot) != candidates.end();
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

  camera.setZoom(0.5);
  status = camera.panByScreen(std::numeric_limits<double>::max(), 0.0);
  test::expect(!status.ok && status.reason != nullptr,
               "a drag that overflows the pan is rejected with a reason");
  test::expectNear(camera.panX(), 10.0, 0.0, "an overflowed pan keeps the previous value");

  status = camera.setZoom(1.0e9);
  test::expect(status.ok, "a finite zoom is still accepted");
  test::expectNear(camera.zoom(), Camera::kMaxZoom, 0.0, "a finite zoom still clamps");

  // setView is atomic: a rejected zoom must not leave a new pan behind.
  Camera atomicCamera;
  atomicCamera.setView(10.0, 20.0, 3.0);
  status = atomicCamera.setView(50.0, 60.0, std::numeric_limits<double>::quiet_NaN());
  test::expect(!status.ok && status.reason != nullptr,
               "a non-finite setView zoom is rejected with a reason");
  test::expectNear(atomicCamera.panX(), 10.0, 0.0, "a rejected setView keeps the pan x");
  test::expectNear(atomicCamera.panY(), 20.0, 0.0, "a rejected setView keeps the pan y");
  test::expectNear(atomicCamera.zoom(), 3.0, 0.0, "a rejected setView keeps the zoom");
  status = atomicCamera.setView(50.0, 60.0, 2.0);
  test::expect(status.ok, "a finite setView is accepted atomically");
  test::expectNear(atomicCamera.panX(), 50.0, 0.0, "an accepted setView commits the pan x");
  test::expectNear(atomicCamera.zoom(), 2.0, 0.0, "an accepted setView commits the zoom");
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

  // A finite world rectangle whose screen quad overflows float must fail loudly
  // instead of producing an infinite instance record.
  Document huge;
  addRectangle(huge, makeRectangle(0.0, 0.0, 1.0e40, 10.0, "a"));
  SpatialIndex hugeSpatial;
  hugeSpatial.rebuild(huge);
  Camera hugeCamera;
  status = buffer.build(huge, hugeCamera, 100.0, 100.0, hugeSpatial);
  test::expect(!status.ok && status.reason != nullptr,
               "a rectangle outside the float range is rejected with a reason");
  test::expect(buffer.empty(), "the float-range failure leaves an empty buffer");
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

  Camera camera;
  CommandBuffer buffer;
  Status status = buffer.build(document, camera, 100.0, 100.0, spatial);
  test::expect(status.ok && buffer.size() == 1, "the current index builds the buffer");

  addRectangle(document, makeRectangle(20.0, 20.0, 10.0, 10.0, "b"));
  status = buffer.build(document, camera, 100.0, 100.0, spatial);
  test::expect(!status.ok && status.reason != nullptr,
               "a stale spatial index is reported instead of silently skipped");
  test::expect(buffer.empty(), "a failed build empties a previously filled buffer");
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

  test::expect(std::string_view(project_air::contracts::kContractVersion) == "0.2.0",
               "the generated contract is version 0.2.0");

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

void documentIdentityAndMutations() {
  test::section("stable ids, incremental mutations, removal and rejection");
  Document document;
  const ObjectId first = addObjectWithId(document, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  const ObjectId second = addObjectWithId(document, makeRectangle(20.0, 0.0, 10.0, 10.0, "b"));
  const ObjectId third =
      addObjectWithId(document, makeRectangle(40.0, 0.0, 10.0, 10.0, "c", Layer::blocks));
  test::expect(first != kInvalidObjectId && first < second && second < third,
               "object ids are monotonic and never zero");
  test::expect(document.size() == 3 && document.version() == 3,
               "three adds leave three live objects at version 3");

  const std::uint32_t firstSlot = slotOf(document, first);
  const std::uint32_t secondSlot = slotOf(document, second);
  const std::uint32_t thirdSlot = slotOf(document, third);
  test::expect(document.slotCount() == 3, "three live objects occupy three slots");

  // Geometry update: in place, same id, version +1, other objects untouched.
  Status status = document.updateGeometry(second, 25.0, 5.0, 30.0, 40.0);
  test::expect(status.ok, "updateGeometry accepts finite geometry");
  test::expect(document.version() == 4, "updateGeometry increments the version once");
  test::expect(document.rectangles()[secondSlot].id == second,
               "a geometry update keeps the object id");
  test::expectNear(document.rectangles()[secondSlot].x, 25.0, 0.0,
                   "a geometry update changes the stored geometry");
  test::expectNear(document.rectangles()[firstSlot].x, 0.0, 0.0,
                   "a geometry update leaves other objects alone");

  // z update: the draw order follows and the inverse restores it.
  const std::vector<std::uint32_t> orderBeforeZ = document.drawOrder();
  status = document.updateZ(first, "z");
  test::expect(status.ok, "updateZ accepts a fractional-order key");
  test::expect(document.version() == 5, "updateZ increments the version once");
  const std::vector<std::uint32_t> orderAfterZ = document.drawOrder();
  test::expect(orderAfterZ.size() == 3 && orderAfterZ[0] == thirdSlot &&
                   orderAfterZ[1] == secondSlot && orderAfterZ[2] == firstSlot,
               "a greater z moves the object above its layer neighbours");
  test::expect(document.drawOrderRank()[firstSlot] == 2,
               "the draw-order rank follows the new z");
  status = document.updateZ(first, "a");
  test::expect(status.ok, "the inverse z update is accepted");
  test::expect(document.drawOrder() == orderBeforeZ,
               "the inverse z update restores the previous draw order");

  // Removal: the other objects keep their id, geometry and relative order.
  const std::uint32_t versionBeforeRemove = document.version();
  status = document.removeObject(first);
  test::expect(status.ok && document.version() == versionBeforeRemove + 1,
               "removeObject increments the version once");
  test::expect(document.size() == 2, "removal lowers the live count");
  test::expect(!document.isLive(firstSlot), "the removed slot is tombstoned");
  test::expect(document.rectangles()[firstSlot].id == kInvalidObjectId,
               "the tombstone keeps no object id");
  std::uint32_t unresolved = 0;
  test::expect(!document.slotForId(first, unresolved).ok,
               "a removed id no longer resolves to a slot");
  test::expect(document.rectangles()[secondSlot].id == second,
               "another object keeps its id after a removal");
  test::expect(document.rectangles()[thirdSlot].id == third,
               "a third object keeps its id after a removal");
  test::expectNear(document.rectangles()[secondSlot].width, 30.0, 0.0,
                   "another object keeps its geometry after a removal");
  const std::vector<std::uint32_t> orderAfterRemove = document.drawOrder();
  test::expect(orderAfterRemove.size() == 2, "the draw order lists only live objects");
  if (orderAfterRemove.size() == 2) {
    test::expect(orderAfterRemove[0] == thirdSlot && orderAfterRemove[1] == secondSlot,
                 "the remaining objects keep their relative draw order");
    test::expect(document.drawOrderRank()[orderAfterRemove[0]] == 0 &&
                     document.drawOrderRank()[orderAfterRemove[1]] == 1,
                 "the ranks are a fresh permutation of the live objects");
  }

  // Reuse: the freed slot is offered to the next insert, the id is not.
  const std::size_t slotsBeforeReuse = document.slotCount();
  const ObjectId fourth =
      addObjectWithId(document, makeRectangle(60.0, 0.0, 10.0, 10.0, "d"));
  test::expect(fourth > third, "a removed object's id is never reused");
  const std::uint32_t fourthSlot = slotOf(document, fourth);
  test::expect(document.slotCount() == slotsBeforeReuse,
               "the freed slot is reused instead of growing storage");
  test::expect(fourthSlot == firstSlot, "the next insert reuses the freed slot");

  // Rejections: nothing is consumed, nothing changes.
  const std::uint32_t versionBeforeRejections = document.version();
  const std::size_t liveBeforeRejections = document.size();
  status = document.updateGeometry(kInvalidObjectId, 1.0, 2.0, 3.0, 4.0);
  test::expect(!status.ok && status.reason != nullptr,
               "an unknown id is rejected with a reason");
  status = document.updateGeometry(second, std::numeric_limits<double>::quiet_NaN(), 0.0, 10.0,
                                   10.0);
  test::expect(!status.ok && status.reason != nullptr,
               "a non-finite geometry update is rejected");
  status = document.updateGeometry(second, std::numeric_limits<double>::max(), 0.0,
                                   std::numeric_limits<double>::max(), 10.0);
  test::expect(!status.ok, "a geometry update whose bounds overflow is rejected");
  test::expectNear(document.rectangles()[secondSlot].x, 25.0, 0.0,
                   "a rejected geometry update leaves the geometry unchanged");
  status = document.updateZ(first, "x");
  test::expect(!status.ok, "a removed id is rejected by updateZ");
  status = document.removeObject(first);
  test::expect(!status.ok, "removing an already removed object is rejected");
  ObjectId rejectedId = kInvalidObjectId;
  status = document.addObject(
      makeRectangle(std::numeric_limits<double>::infinity(), 0.0, 10.0, 10.0, "e"), rejectedId);
  test::expect(!status.ok && rejectedId == kInvalidObjectId,
               "a non-finite add is rejected without assigning an id");
  test::expect(document.version() == versionBeforeRejections &&
                   document.size() == liveBeforeRejections,
               "rejected mutations leave the document unchanged");

  // A full document rejects the insert without consuming an id or a version.
  Document full;
  fillFiftyThousandRectangles(full);
  const std::uint32_t fullVersion = full.version();
  ObjectId overflowId = kInvalidObjectId;
  status = full.addObject(makeRectangle(0.0, 0.0, 1.0, 1.0, "z"), overflowId);
  test::expect(!status.ok && status.reason != nullptr && overflowId == kInvalidObjectId,
               "the 50,001st object is rejected with a reason and without an id");
  test::expect(full.version() == fullVersion && full.size() == Document::kMaxRectangles,
               "a full document stays unchanged after a rejected add");

  // Removing the last object keeps the document usable and the storage reserved.
  Document lastOne;
  const ObjectId onlyObject =
      addObjectWithId(lastOne, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  const std::uint32_t onlySlot = slotOf(lastOne, onlyObject);
  status = lastOne.removeObject(onlyObject);
  test::expect(status.ok && lastOne.size() == 0 && lastOne.slotCount() == 1,
               "removing the last object keeps the reserved slot");
  test::expect(lastOne.drawOrder().empty() && !lastOne.isLive(onlySlot),
               "a document without live objects has an empty draw order");
  const ObjectId reinserted =
      addObjectWithId(lastOne, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  test::expect(reinserted > onlyObject && slotOf(lastOne, reinserted) == onlySlot,
               "the last slot is reused while the id is not");

  // clear() keeps the id sequence monotonic.
  Document reloaded;
  const ObjectId beforeClear =
      addObjectWithId(reloaded, makeRectangle(0.0, 0.0, 1.0, 1.0, "a"));
  reloaded.clear();
  test::expect(reloaded.size() == 0, "clear removes every live object");
  const ObjectId afterClear =
      addObjectWithId(reloaded, makeRectangle(0.0, 0.0, 1.0, 1.0, "a"));
  test::expect(afterClear > beforeClear, "object ids are not reused after clear");
}

void mutationCommandBufferRoundTrip() {
  test::section("mutation plus inverse restores a byte-identical command buffer");
  Document document;
  const ObjectId blockObject = addObjectWithId(
      document, makeRectangle(10.0, 10.0, 60.0, 40.0, "a", Layer::blocks, Tone::toneA));
  const ObjectId cardB = addObjectWithId(
      document, makeRectangle(100.0, 30.0, 80.0, 60.0, "b", Layer::noteCards, Tone::toneB));
  const ObjectId cardC = addObjectWithId(
      document, makeRectangle(40.0, 120.0, 50.0, 50.0, "c", Layer::noteCards, Tone::toneC));
  const std::uint32_t blockSlot = slotOf(document, blockObject);
  const std::uint32_t bSlot = slotOf(document, cardB);
  const std::uint32_t cSlot = slotOf(document, cardC);

  Camera camera;
  SpatialIndex spatial;
  spatial.rebuild(document);
  CommandBuffer buffer;
  const std::vector<std::uint8_t> baseline = captureBytes(buffer, document, camera, spatial);
  test::expect(buffer.size() == 3, "the baseline frame draws the three objects");
  test::expect(!baseline.empty(), "the baseline frame has record bytes");

  // A move and its inverse: geometry, spatial index and buffer follow in place.
  Status status = document.updateGeometry(cardB, 320.0, 30.0, 80.0, 60.0);
  test::expect(status.ok, "a move is accepted");
  spatial.updateSlot(document, bSlot);
  test::expect(spatial.isCurrent(document),
               "the index follows a move without a full rebuild");
  std::vector<std::uint32_t> candidates;
  Status queryStatus = spatial.queryPoint({325.0, 40.0}, candidates);
  test::expect(queryStatus.ok && candidatesContain(candidates, bSlot),
               "the moved object is found at its new position");
  queryStatus = spatial.queryPoint({105.0, 40.0}, candidates);
  test::expect(queryStatus.ok && !candidatesContain(candidates, bSlot),
               "the moved object is gone from its old cell");
  const std::vector<std::uint8_t> moved = captureBytes(buffer, document, camera, spatial);
  test::expect(buffer.size() == 3, "the moved frame still draws three objects");
  test::expect(moved != baseline, "a move changes the command buffer");
  status = document.updateGeometry(cardB, 100.0, 30.0, 80.0, 60.0);
  test::expect(status.ok, "the inverse move is accepted");
  spatial.updateSlot(document, bSlot);
  expectSameBytes(captureBytes(buffer, document, camera, spatial), baseline,
                  "moving an object and back restores the byte-identical command buffer");

  // A resize and its inverse.
  status = document.updateGeometry(cardC, 40.0, 120.0, 90.0, 80.0);
  test::expect(status.ok, "a resize is accepted");
  spatial.updateSlot(document, cSlot);
  const std::vector<std::uint8_t> resized = captureBytes(buffer, document, camera, spatial);
  test::expect(buffer.size() == 3 && resized != baseline,
               "a resize changes the command buffer");
  status = document.updateGeometry(cardC, 40.0, 120.0, 50.0, 50.0);
  test::expect(status.ok, "the inverse resize is accepted");
  spatial.updateSlot(document, cSlot);
  expectSameBytes(captureBytes(buffer, document, camera, spatial), baseline,
                  "resizing an object and back restores the byte-identical command buffer");

  // A z change and its inverse: the draw order and the buffer follow.
  const std::vector<std::uint32_t> orderBeforeZ = document.drawOrder();
  status = document.updateZ(cardB, "d");
  test::expect(status.ok, "a z update is accepted");
  spatial.syncVersion(document);
  test::expect(spatial.isCurrent(document), "the index follows a z-only mutation");
  const std::vector<std::uint32_t>& reorderedOrder = document.drawOrder();
  test::expect(reorderedOrder.size() == 3 && reorderedOrder[0] == blockSlot &&
                   reorderedOrder[1] == cSlot && reorderedOrder[2] == bSlot,
               "a greater z moves the object above its layer neighbour");
  const std::vector<std::uint8_t> reordered = captureBytes(buffer, document, camera, spatial);
  test::expect(reordered != baseline, "a z change changes the command buffer order");
  status = document.updateZ(cardB, "b");
  test::expect(status.ok, "the inverse z update is accepted");
  spatial.syncVersion(document);
  test::expect(document.drawOrder() == orderBeforeZ,
               "the inverse z update restores the draw order");
  expectSameBytes(captureBytes(buffer, document, camera, spatial), baseline,
                  "restoring the z restores the byte-identical command buffer");

  // An add and its inverse: the freed slot is kept, the buffer returns.
  const std::size_t slotsBeforeAdd = document.slotCount();
  const ObjectId added = addObjectWithId(
      document, makeRectangle(300.0, 300.0, 40.0, 40.0, "d", Layer::blocks, Tone::toneD));
  const std::uint32_t addedSlot = slotOf(document, added);
  spatial.updateSlot(document, addedSlot);
  test::expect(spatial.isCurrent(document), "the index follows an insert");
  const std::vector<std::uint8_t> withAdded = captureBytes(buffer, document, camera, spatial);
  test::expect(buffer.size() == 4, "the added object becomes a fourth instance");
  test::expect(withAdded.size() > baseline.size(), "an add grows the command buffer");
  status = document.removeObject(added);
  test::expect(status.ok, "the added object can be removed again");
  spatial.removeSlot(document, addedSlot);
  test::expect(spatial.isCurrent(document), "the index follows a removal");
  expectSameBytes(captureBytes(buffer, document, camera, spatial), baseline,
                  "adding and removing an object restores the byte-identical command buffer");
  test::expect(document.slotCount() == slotsBeforeAdd + 1,
               "the freed slot stays reserved as a tombstone for reuse");
}

void commandBufferHitTesting() {
  test::section("hit testing: draw-order precedence, edges and rejection");
  Document document;
  const ObjectId lowLayer = addObjectWithId(
      document, makeRectangle(0.0, 0.0, 100.0, 100.0, "z", Layer::blocks, Tone::toneA));
  const ObjectId cardA = addObjectWithId(
      document, makeRectangle(0.0, 0.0, 100.0, 100.0, "a", Layer::noteCards, Tone::toneB));
  const ObjectId cardB = addObjectWithId(
      document, makeRectangle(0.0, 0.0, 100.0, 100.0, "b", Layer::noteCards, Tone::toneC));
  const ObjectId cardB2 = addObjectWithId(
      document, makeRectangle(0.0, 0.0, 100.0, 100.0, "b", Layer::noteCards, Tone::toneD));
  const std::uint32_t lowSlot = slotOf(document, lowLayer);
  const std::uint32_t aSlot = slotOf(document, cardA);
  const std::uint32_t bSlot = slotOf(document, cardB);
  const std::uint32_t b2Slot = slotOf(document, cardB2);

  Camera camera;
  SpatialIndex spatial;
  spatial.rebuild(document);
  CommandBuffer buffer;
  HitResult hit;
  Status status =
      buffer.hitTest(document, camera, spatial, 800.0, 600.0, {50.0, 50.0}, hit);
  test::expect(status.ok && hit.found && hit.slot == b2Slot && hit.objectId == cardB2,
               "the topmost is the latest insertion of the greatest z on the highest layer");
  const std::uint32_t versionBeforeHits = document.version();

  status = document.removeObject(cardB2);
  test::expect(status.ok, "the topmost object can be removed");
  spatial.removeSlot(document, b2Slot);
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0, {50.0, 50.0}, hit);
  test::expect(status.ok && hit.found && hit.slot == bSlot,
               "with the later equal-z object removed the earlier one wins");

  status = document.removeObject(cardB);
  test::expect(status.ok, "the equal-z predecessor can be removed");
  spatial.removeSlot(document, bSlot);
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0, {50.0, 50.0}, hit);
  test::expect(status.ok && hit.found && hit.slot == aSlot,
               "a higher layer beats a lower layer's greater z");

  status = document.removeObject(cardA);
  test::expect(status.ok, "the top card can be removed");
  spatial.removeSlot(document, aSlot);
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0, {50.0, 50.0}, hit);
  test::expect(status.ok && hit.found && hit.slot == lowSlot,
               "removal exposes the remaining object to the hit test");
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0, {500.0, 500.0}, hit);
  test::expect(status.ok && !hit.found && hit.slot == kNoObject &&
                   hit.objectId == kInvalidObjectId,
               "a point without objects returns the empty result");
  test::expect(document.version() == versionBeforeHits + 3,
               "hit tests never mutate the document");

  // Edges and corners are inclusive; the draw order picks one deterministically.
  Document edges;
  const ObjectId left = addObjectWithId(edges, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  const ObjectId right = addObjectWithId(edges, makeRectangle(10.0, 0.0, 10.0, 10.0, "a"));
  const std::uint32_t leftSlot = slotOf(edges, left);
  const std::uint32_t rightSlot = slotOf(edges, right);
  SpatialIndex edgeSpatial;
  edgeSpatial.rebuild(edges);
  CommandBuffer edgeBuffer;
  HitResult edgeHit;
  status = edgeBuffer.hitTest(edges, camera, edgeSpatial, 800.0, 600.0, {10.0, 5.0}, edgeHit);
  test::expect(status.ok && edgeHit.slot == rightSlot,
               "a point on a shared edge hits both and the later insertion wins");
  status = edgeBuffer.hitTest(edges, camera, edgeSpatial, 800.0, 600.0, {10.0, 0.0}, edgeHit);
  test::expect(status.ok && edgeHit.slot == rightSlot,
               "a shared corner follows the same deterministic rule");
  status = edgeBuffer.hitTest(edges, camera, edgeSpatial, 800.0, 600.0, {0.0, 0.0}, edgeHit);
  test::expect(status.ok && edgeHit.slot == leftSlot,
               "the top-left corner of an object counts as a hit");

  // The screen point is mapped through the camera before the hit test.
  Document mapped;
  const ObjectId mappedId = addObjectWithId(
      mapped, makeRectangle(100.0, 200.0, 50.0, 50.0, "a", Layer::noteCards));
  const std::uint32_t mappedSlot = slotOf(mapped, mappedId);
  Camera mappedCamera;
  test::expect(mappedCamera.setView(100.0, 200.0, 2.0).ok, "the camera is placed on the object");
  SpatialIndex mappedSpatial;
  mappedSpatial.rebuild(mapped);
  CommandBuffer mappedBuffer;
  HitResult mappedHit;
  status = mappedBuffer.hitTest(mapped, mappedCamera, mappedSpatial, 800.0, 600.0,
                                {10.0, 10.0}, mappedHit);
  test::expect(status.ok && mappedHit.slot == mappedSlot,
               "a screen point maps through the camera before the hit test");
  status = mappedBuffer.hitTest(mapped, mappedCamera, mappedSpatial, 800.0, 600.0,
                                {101.0, 101.0}, mappedHit);
  test::expect(status.ok && !mappedHit.found, "a point outside the mapped quad is not a hit");

  // Rejections leave the result empty; the empty document is a valid query.
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0,
                          {std::numeric_limits<double>::quiet_NaN(), 5.0}, hit);
  test::expect(!status.ok && status.reason != nullptr && !hit.found,
               "a non-finite screen point is rejected with an empty result");
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0,
                          {5.0, std::numeric_limits<double>::infinity()}, hit);
  test::expect(!status.ok && !hit.found, "an infinite screen point is rejected");
  status = buffer.hitTest(document, camera, spatial, 0.0, 600.0, {5.0, 5.0}, hit);
  test::expect(!status.ok && status.reason != nullptr && !hit.found,
               "a zero-size viewport is rejected");
  status = buffer.hitTest(document, camera, spatial,
                          std::numeric_limits<double>::quiet_NaN(), 600.0, {5.0, 5.0}, hit);
  test::expect(!status.ok && !hit.found, "a non-finite viewport is rejected");

  Document emptyDocument;
  SpatialIndex emptySpatial;
  emptySpatial.rebuild(emptyDocument);
  CommandBuffer emptyBuffer;
  HitResult emptyHit;
  status = emptyBuffer.hitTest(emptyDocument, camera, emptySpatial, 800.0, 600.0, {10.0, 10.0},
                               emptyHit);
  test::expect(status.ok && !emptyHit.found && emptyHit.slot == kNoObject &&
                   emptyHit.objectId == kInvalidObjectId,
               "an empty document returns the empty result without a division");

  Document staleDocument;
  addObjectWithId(staleDocument, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  SpatialIndex staleSpatial;
  staleSpatial.rebuild(staleDocument);
  addObjectWithId(staleDocument, makeRectangle(20.0, 0.0, 10.0, 10.0, "b"));
  CommandBuffer staleBuffer;
  HitResult staleHit;
  status = staleBuffer.hitTest(staleDocument, camera, staleSpatial, 800.0, 600.0, {5.0, 5.0},
                               staleHit);
  test::expect(!status.ok && status.reason != nullptr,
               "a stale index is reported instead of returning a wrong hit");
}

void spatialPointAndBoundsQueries() {
  test::section("spatial point and bounds queries return document-ordered candidates");
  Document document;
  const ObjectId nearId = addObjectWithId(document, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  const ObjectId middleId = addObjectWithId(document, makeRectangle(300.0, 0.0, 10.0, 10.0, "b"));
  const ObjectId farId = addObjectWithId(document, makeRectangle(600.0, 0.0, 10.0, 10.0, "c"));
  const std::uint32_t nearSlot = slotOf(document, nearId);
  const std::uint32_t middleSlot = slotOf(document, middleId);
  const std::uint32_t farSlot = slotOf(document, farId);

  SpatialIndex spatial;
  spatial.rebuild(document);
  test::expect(spatial.isCurrent(document), "a rebuilt index is current for its document");
  std::vector<std::uint32_t> candidates;
  Status status = spatial.query({0.0, 0.0, 1.0, 1.0}, candidates);
  test::expect(status.ok && candidates.size() == 1 && candidates[0] == nearSlot,
               "a narrow bounds query returns only the intersecting object");
  status = spatial.query({0.0, 0.0, 700.0, 10.0}, candidates);
  test::expect(status.ok && candidates.size() == 3, "a wide bounds query returns every object");
  if (candidates.size() == 3) {
    test::expect(candidates[0] == nearSlot && candidates[1] == middleSlot &&
                     candidates[2] == farSlot,
                 "candidates arrive in document order");
  }
  status = spatial.queryPoint({305.0, 5.0}, candidates);
  test::expect(status.ok && candidates.size() == 1 && candidates[0] == middleSlot,
               "a point query returns the object under the point");

  // A rectangle spanning several cells is offered exactly once, not once per cell.
  const ObjectId wideId = addObjectWithId(document, makeRectangle(0.0, 0.0, 700.0, 10.0, "d"));
  const std::uint32_t wideSlot = slotOf(document, wideId);
  spatial.updateSlot(document, wideSlot);
  test::expect(spatial.isCurrent(document), "the index follows an insert");
  status = spatial.queryPoint({305.0, 5.0}, candidates);
  test::expect(status.ok, "the point query succeeds after the insert");
  test::expect(std::count(candidates.begin(), candidates.end(), wideSlot) == 1,
               "a rectangle spanning several cells is offered exactly once");
  test::expect(candidatesContain(candidates, middleSlot),
               "a plain candidate is still returned next to the spanning one");

  // An oversized rectangle stays a candidate everywhere (the buffer filters it).
  const ObjectId oversizedId =
      addObjectWithId(document, makeRectangle(0.0, 0.0, 40000.0, 40000.0, "e"));
  const std::uint32_t oversizedSlot = slotOf(document, oversizedId);
  spatial.updateSlot(document, oversizedSlot);
  status = spatial.queryPoint({100000.0, 100000.0}, candidates);
  test::expect(status.ok && candidatesContain(candidates, oversizedSlot),
               "an oversized rectangle is always offered as a candidate");

  // Incremental move: the old cell no longer offers the slot, the new one does.
  status = document.updateGeometry(middleId, 520.0, 0.0, 10.0, 10.0);
  test::expect(status.ok, "the move behind the incremental query is accepted");
  spatial.updateSlot(document, middleSlot);
  status = spatial.queryPoint({305.0, 5.0}, candidates);
  test::expect(status.ok && !candidatesContain(candidates, middleSlot),
               "a moved object leaves its old cell");
  status = spatial.queryPoint({525.0, 5.0}, candidates);
  test::expect(status.ok && candidatesContain(candidates, middleSlot),
               "a moved object enters its new cell");

  // Removal: the slot disappears from the candidates and the index stays bound.
  status = document.removeObject(farId);
  test::expect(status.ok, "the far object can be removed");
  spatial.removeSlot(document, farSlot);
  test::expect(spatial.isCurrent(document), "the index follows a removal");
  status = spatial.queryPoint({605.0, 5.0}, candidates);
  test::expect(status.ok && !candidatesContain(candidates, farSlot),
               "a removed object is no longer a candidate");

  // A non-finite bound is clamped onto the grid instead of casting UB.
  status = spatial.query({std::numeric_limits<double>::quiet_NaN(), 0.0, 1.0, 1.0}, candidates);
  std::vector<std::uint32_t> clamped;
  const Status clampedStatus = spatial.query({0.0, 0.0, 1.0, 1.0}, clamped);
  test::expect(status.ok && clampedStatus.ok && candidates == clamped,
               "a non-finite bound is clamped to the origin cell");

  // A never-built index reports a failure instead of returning stale candidates.
  SpatialIndex unbuilt;
  status = unbuilt.query({0.0, 0.0, 1.0, 1.0}, candidates);
  test::expect(!status.ok && status.reason != nullptr,
               "a never-built index reports a failure");
}

void packedLoadAndSpatialGuard() {
  test::section("a rejected packed load is atomic and the patch guard rebuilds a stale index");

  // Previous, valid document loaded through the packed C ABI format.
  const float previous[3 * 6] = {
      10.0F,  10.0F,  60.0F, 40.0F, 0.0F, 1.0F,
      100.0F, 30.0F,  80.0F, 60.0F, 1.0F, 2.0F,
      40.0F,  120.0F, 50.0F, 50.0F, 2.0F, 2.0F,
  };
  Document document;
  Status status = document.loadPackedRectangles(previous, 3);
  test::expect(status.ok && document.size() == 3, "a valid packed load fills the document");
  const std::uint32_t versionAfterLoad = document.version();
  const ObjectId firstLoaded = document.rectangles()[0].id;
  const ObjectId secondLoaded = document.rectangles()[1].id;
  Camera camera;
  SpatialIndex spatial;
  spatial.rebuild(document);
  CommandBuffer buffer;
  const std::vector<std::uint8_t> baseline = captureBytes(buffer, document, camera, spatial);
  test::expect(buffer.size() == 3, "the loaded objects are visible");

  // Three valid records and a NaN: the load must fail before replacing anything.
  const float invalid[4 * 6] = {
      10.0F,  10.0F,  60.0F, 40.0F, 0.0F, 1.0F,
      100.0F, 30.0F,  80.0F, 60.0F, 1.0F, 2.0F,
      40.0F,  120.0F, 50.0F, 50.0F, 2.0F, 2.0F,
      std::numeric_limits<float>::quiet_NaN(), 0.0F, 10.0F, 10.0F, 0.0F, 2.0F,
  };
  status = document.loadPackedRectangles(invalid, 4);
  test::expect(!status.ok && status.reason != nullptr, "a packed load with a NaN is rejected");
  test::expect(document.size() == 3 && document.version() == versionAfterLoad,
               "a rejected packed load leaves the document unchanged");
  test::expect(spatial.isCurrent(document), "a rejected packed load leaves the index current");
  expectSameBytes(captureBytes(buffer, document, camera, spatial), baseline,
                  "a rejected packed load leaves the command buffer byte-identical");

  // Count, null and non-finite-ordinal rejections are atomic too.
  Document untouched;
  const float invalidOrdinal[6] = {0.0F, 0.0F, 10.0F, 10.0F,
                                   std::numeric_limits<float>::quiet_NaN(), 0.0F};
  test::expect(!untouched.loadPackedRectangles(nullptr, 1).ok,
               "a null packed load is rejected");
  test::expect(!untouched.loadPackedRectangles(previous, -1).ok,
               "a negative packed count is rejected");
  test::expect(!untouched.loadPackedRectangles(invalidOrdinal, 1).ok,
               "a packed load with a non-finite ordinal is rejected");
  std::vector<float> oversized(static_cast<std::size_t>(Document::kMaxRectangles + 1) * 6, 0.0F);
  test::expect(!untouched.loadPackedRectangles(oversized.data(),
                                               static_cast<int>(Document::kMaxRectangles + 1))
                    .ok,
               "an oversized packed load is rejected");
  test::expect(untouched.size() == 0 && untouched.version() == 0,
               "rejected packed loads leave an empty document untouched");

  // The next incremental add, frame build and hit tests see every live object.
  const ObjectId added = addObjectWithId(
      document, makeRectangle(300.0, 300.0, 40.0, 40.0, "d", Layer::blocks));
  const std::uint32_t addedSlot = slotOf(document, added);
  spatial.updateSlot(document, addedSlot);
  test::expect(spatial.isCurrent(document), "the next incremental add keeps the index current");
  const std::vector<std::uint8_t> withAdded = captureBytes(buffer, document, camera, spatial);
  test::expect(buffer.size() == 4, "the frame after the rejected load draws every live object");
  test::expect(withAdded.size() > baseline.size(),
               "the frame after the rejected load includes the new object");
  HitResult hit;
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0, {15.0, 15.0}, hit);
  test::expect(status.ok && hit.found && hit.objectId == firstLoaded,
               "hit testing finds an object loaded before the rejected load");
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0, {105.0, 40.0}, hit);
  test::expect(status.ok && hit.found && hit.objectId == secondLoaded,
               "hit testing finds a second object loaded before the rejected load");
  status = buffer.hitTest(document, camera, spatial, 800.0, 600.0, {305.0, 305.0}, hit);
  test::expect(status.ok && hit.found && hit.objectId == added,
               "hit testing finds the object added after the rejected load");

  // Defence in depth: every ABI mutation first rebuilds an index left stale by a
  // path outside the incremental patch (SpatialIndex::ensureCurrent).
  Document stale;
  addObjectWithId(stale, makeRectangle(0.0, 0.0, 10.0, 10.0, "a"));
  SpatialIndex staleSpatial;
  staleSpatial.rebuild(stale);
  const ObjectId staleSecond =
      addObjectWithId(stale, makeRectangle(20.0, 0.0, 10.0, 10.0, "b"));
  const std::uint32_t staleSecondSlot = slotOf(stale, staleSecond);
  test::expect(!staleSpatial.isCurrent(stale),
               "a direct document mutation leaves the index stale");
  staleSpatial.ensureCurrent(stale);
  test::expect(staleSpatial.isCurrent(stale), "the patch guard rebuilds a stale index");
  std::vector<std::uint32_t> candidates;
  status = staleSpatial.query({0.0, 0.0, 100.0, 10.0}, candidates);
  test::expect(status.ok && candidates.size() == 2 &&
                   candidatesContain(candidates, staleSecondSlot),
               "the rebuilt index knows every live object again");
  const ObjectId staleThird =
      addObjectWithId(stale, makeRectangle(40.0, 0.0, 10.0, 10.0, "c"));
  staleSpatial.updateSlot(stale, slotOf(stale, staleThird));
  test::expect(staleSpatial.isCurrent(stale),
               "an incremental patch after the guard stays current");
  status = staleSpatial.query({0.0, 0.0, 100.0, 10.0}, candidates);
  test::expect(status.ok && candidates.size() == 3,
               "the patched index sees every live object");
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
  documentIdentityAndMutations();
  mutationCommandBufferRoundTrip();
  commandBufferHitTesting();
  spatialPointAndBoundsQueries();
  packedLoadAndSpatialGuard();

  if (test::failures != 0) {
    std::fprintf(stderr, "engine_core_tests: %d check(s) failed\n", test::failures);
    return 1;
  }
  std::puts("engine_core_tests: all checks passed");
  return 0;
}
