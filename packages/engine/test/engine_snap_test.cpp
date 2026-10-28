// Native suite of the L07 snapping core (P4-15): edge, centre, tolerance just
// below/at/above the 6 px screen tolerance at several zooms, line-over-grid
// precedence, grid fallback, Shift free, at most three guides, dragged-object
// exclusion, determinism, visibility, guide spans and the invalid-input paths.

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string_view>
#include <vector>

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/snap.h"
#include "engine/spatial.h"
#include "engine/status.h"
#include "test_support.h"
#include "tokens.h"

namespace {

using air::engine::Camera;
using air::engine::Document;
using air::engine::Layer;
using air::engine::ObjectId;
using air::engine::Rectangle;
using air::engine::SnapGuide;
using air::engine::SnapOrientation;
using air::engine::SnapResult;
using air::engine::SnapScratch;
using air::engine::SpatialIndex;
using air::engine::Status;
using air::engine::Tone;
using air::engine::kMaxSnapGuides;
using air::engine::snapPosition;

namespace test = air::engine::test;

constexpr double kTolerance = 6.0;
constexpr double kViewportWidth = 800.0;
constexpr double kViewportHeight = 600.0;

Rectangle rectangle(double x, double y, double width, double height, Layer layer) {
  Rectangle value;
  value.x = x;
  value.y = y;
  value.width = width;
  value.height = height;
  value.layer = layer;
  value.tone = Tone::neutral;
  return value;
}

std::uint32_t add(Document& document, const Rectangle& value) {
  ObjectId id = air::engine::kInvalidObjectId;
  const Status status = document.addObject(value, id);
  test::expect(status.ok, "object added");
  std::uint32_t slot = 0;
  test::expect(document.slotForId(id, slot).ok, "slot resolves");
  return slot;
}

Camera cameraAt(double panX, double panY, double zoom) {
  Camera camera;
  test::expect(camera.setView(panX, panY, zoom).ok, "camera view set");
  return camera;
}

// Snaps `draggedSlot` at (x, y) and returns success; `expectedOk` is asserted by
// the caller through the return value.
bool snap(Document& document, SpatialIndex& spatial, const Camera& camera,
          std::uint32_t draggedSlot, double x, double y, bool free, SnapScratch& scratch,
          SnapResult& result) {
  const Status status = snapPosition(document, spatial, camera, draggedSlot, kViewportWidth,
                                     kViewportHeight, x, y, free, scratch, result);
  return status.ok;
}

void testEdgeAndCentre() {
  test::section("edges and centres of a neighbour snap, with the guide span");

  Document document;
  SpatialIndex spatial;
  const std::uint32_t dragged = add(document, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  add(document, rectangle(200.0, 300.0, 80.0, 60.0, Layer::blocks));
  spatial.rebuild(document);
  Camera camera = cameraAt(0.0, 0.0, 1.0);
  SnapScratch scratch;
  SnapResult result;
  test::expect(snap(document, spatial, camera, dragged, 195.0, 100.0, false, scratch, result),
               "edge snap succeeds");
  test::expect(result.snappedX, "a line decided x");
  test::expectNear(result.x, 200.0, 1e-9, "the dragged left edge snaps to the neighbour left edge");
  test::expect(!result.snappedY, "no y line is in tolerance");
  test::expectNear(result.y, air::engine::Camera::snapToGrid(100.0), 1e-9,
                   "the y axis falls back to the grid");
  test::expect(result.guideCount >= 1, "the edge match draws a guide");
  test::expect(result.guides[0].orientation == SnapOrientation::vertical,
               "the edge guide is vertical");
  test::expectNear(result.guides[0].position, 200.0, 1e-9, "the guide sits on the matched line");
  // y fell back to the 96 px grid, so the span starts 16 px above that edge.
  test::expectNear(result.guides[0].start, 96.0 - tokens::space_16, 1e-9,
                   "the guide starts 16 px above the higher element");
  test::expectNear(result.guides[0].end, 360.0 + tokens::space_16, 1e-9,
                   "the guide ends 16 px below the lower element");

  // Centre: a wider neighbour at 200..320; the dragged centre lands 5 px from the
  // neighbour centre, which is closer than any edge pair.
  Document centred;
  SpatialIndex centredSpatial;
  const std::uint32_t draggedCentre =
      add(centred, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  add(centred, rectangle(200.0, 300.0, 120.0, 60.0, Layer::blocks));
  centredSpatial.rebuild(centred);
  SnapScratch centredScratch;
  SnapResult centreResult;
  test::expect(snap(centred, centredSpatial, camera, draggedCentre, 225.0, 100.0, false,
                    centredScratch, centreResult),
               "centre snap succeeds");
  test::expect(centreResult.snappedX, "the centre match is a line match");
  test::expectNear(centreResult.x, 220.0, 1e-9, "the dragged position moves by the centre delta");
  test::expectNear(centreResult.guides[0].position, 260.0, 1e-9,
                   "the guide sits on the matched centre line");
}

void testTolerance() {
  test::section("6 px screen tolerance: below, at and above, at three zooms");

  Document document;
  SpatialIndex spatial;
  const std::uint32_t dragged = add(document, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  add(document, rectangle(200.0, 300.0, 80.0, 60.0, Layer::blocks));
  spatial.rebuild(document);
  SnapScratch scratch;

  struct Case {
    double zoom;
    double rawX;
    bool expectLine;
    double expectedX;
    std::string_view label;
  };
  const Case cases[] = {
      {1.0, 195.0, true, 200.0, "zoom 1: 5 px snaps"},
      {1.0, 194.1, true, 200.0, "zoom 1: 5.9 px snaps"},
      {1.0, 194.0, true, 200.0, "zoom 1: exactly 6 px snaps"},
      {1.0, 193.9, false, air::engine::Camera::snapToGrid(193.9), "zoom 1: 6.1 px does not snap"},
      {0.5, 189.0, true, 200.0, "zoom 0.5: 11 world px = 5.5 screen px snaps"},
      {0.5, 187.0, false, air::engine::Camera::snapToGrid(187.0),
       "zoom 0.5: 13 world px = 6.5 screen px does not snap"},
      {2.0, 197.5, true, 200.0, "zoom 2: 2.5 world px = 5 screen px snaps"},
      {2.0, 196.5, false, air::engine::Camera::snapToGrid(196.5),
       "zoom 2: 3.5 world px = 7 screen px does not snap"},
  };
  for (const Case& value : cases) {
    const Camera camera = cameraAt(0.0, 0.0, value.zoom);
    SnapResult result;
    test::expect(snap(document, spatial, camera, dragged, value.rawX, 100.0, false, scratch, result),
                 "tolerance case succeeds");
    test::expect(result.snappedX == value.expectLine, value.label);
    test::expectNear(result.x, value.expectedX, 1e-9, "tolerance case position");
  }
  test::expect(kTolerance == tokens::snap_tolerance, "the tolerance comes from the token");
}

void testPrecedenceAndGrid() {
  test::section("a line match beats the grid; without a match the 16 px grid applies");

  Document document;
  SpatialIndex spatial;
  const std::uint32_t dragged = add(document, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  add(document, rectangle(200.0, 300.0, 80.0, 60.0, Layer::blocks));
  spatial.rebuild(document);
  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  SnapScratch scratch;
  SnapResult result;
  // 205 is 5 px from the 200 line and 3 px from the 208 grid line.
  test::expect(snap(document, spatial, camera, dragged, 205.0, 100.0, false, scratch, result),
               "precedence case succeeds");
  test::expect(result.snappedX, "the line match wins over the grid");
  test::expectNear(result.x, 200.0, 1e-9, "the position is on the line, not on the grid");

  Document empty;
  SpatialIndex emptySpatial;
  const std::uint32_t lone = add(empty, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  emptySpatial.rebuild(empty);
  SnapScratch emptyScratch;
  SnapResult grid;
  test::expect(snap(empty, emptySpatial, camera, lone, 101.0, 103.0, false, emptyScratch, grid),
               "grid fallback succeeds");
  test::expect(!grid.snappedX && !grid.snappedY, "only the grid decided both axes");
  test::expectNear(grid.x, 96.0, 1e-9, "x is a multiple of the 16 px grid");
  test::expectNear(grid.y, 96.0, 1e-9, "y is a multiple of the 16 px grid");
  test::expect(grid.guideCount == 0, "a grid snap draws no guide");
}

void testShiftFree() {
  test::section("Shift frees the position: no line, no grid, no guide");

  Document document;
  SpatialIndex spatial;
  const std::uint32_t dragged = add(document, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  add(document, rectangle(200.0, 100.0, 80.0, 60.0, Layer::blocks));
  spatial.rebuild(document);
  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  SnapScratch scratch;
  SnapResult result;
  test::expect(snap(document, spatial, camera, dragged, 195.0, 105.0, true, scratch, result),
               "the free snap succeeds");
  test::expectNear(result.x, 195.0, 1e-9, "Shift keeps the pointer x");
  test::expectNear(result.y, 105.0, 1e-9, "Shift keeps the pointer y");
  test::expect(!result.snappedX && !result.snappedY, "nothing snapped");
  test::expect(result.guideCount == 0, "no guide is drawn while free");
}

void testMaxThreeGuides() {
  test::section("at most three guides, deterministic order");

  Document document;
  SpatialIndex spatial;
  // Same size and same top: left, centre and right all coincide after the snap.
  const std::uint32_t dragged = add(document, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  add(document, rectangle(200.0, 100.0, 80.0, 60.0, Layer::blocks));
  spatial.rebuild(document);
  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  SnapScratch scratch;
  SnapResult result;
  test::expect(snap(document, spatial, camera, dragged, 195.0, 100.0, false, scratch, result),
               "the multi-guide snap succeeds");
  test::expect(result.guideCount == kMaxSnapGuides, "not more than three guides");
  test::expect(kMaxSnapGuides == 3, "L07 caps the guides at three");
  for (std::size_t index = 0; index < result.guideCount; ++index) {
    test::expect(result.guides[index].orientation == SnapOrientation::vertical,
                 "the three guides are the coincident vertical lines");
  }
  test::expect(result.guides[0].position < result.guides[1].position &&
                   result.guides[1].position < result.guides[2].position,
               "guide positions are deterministic and ascending");

  SnapResult again;
  SnapScratch againScratch;
  test::expect(snap(document, spatial, camera, dragged, 195.0, 100.0, false, againScratch, again),
               "the repeated snap succeeds");
  test::expect(std::memcmp(&result, &again, sizeof(SnapResult)) == 0,
               "the same input produces a byte-identical result");
}

void testExclusionAndVisibility() {
  test::section("the dragged object never snaps to itself; invisible objects are ignored");

  Document document;
  SpatialIndex spatial;
  const std::uint32_t dragged = add(document, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  spatial.rebuild(document);
  Camera camera = cameraAt(0.0, 0.0, 1.0);
  SnapScratch scratch;
  SnapResult result;
  test::expect(snap(document, spatial, camera, dragged, 100.0, 100.0, false, scratch, result),
               "the lone-object snap succeeds");
  test::expect(!result.snappedX && !result.snappedY, "the dragged object is excluded");
  test::expect(result.guideCount == 0, "no guide from itself");

  // A neighbour whose line is in tolerance but which lies outside the viewport.
  Document visibleDocument;
  SpatialIndex visibleSpatial;
  const std::uint32_t near = add(visibleDocument,
                                 rectangle(750.0, 100.0, 80.0, 60.0, Layer::noteCards));
  add(visibleDocument, rectangle(850.0, 300.0, 80.0, 60.0, Layer::blocks));
  visibleSpatial.rebuild(visibleDocument);
  SnapScratch visibleScratch;
  SnapResult invisibleResult;
  test::expect(snap(visibleDocument, visibleSpatial, camera, near, 845.0, 100.0, false,
                    visibleScratch, invisibleResult),
               "the visibility case succeeds");
  test::expect(!invisibleResult.snappedX, "a neighbour outside the viewport is ignored");
}

void testInvalidInputs() {
  test::section("invalid input fails and leaves the result untouched");

  Document document;
  SpatialIndex spatial;
  const std::uint32_t dragged = add(document, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  spatial.rebuild(document);
  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  SnapScratch scratch;
  SnapResult untouched;
  untouched.x = 7.0;
  untouched.y = 9.0;

  SnapResult result = untouched;
  test::expect(!snapPosition(document, spatial, camera, 99, kViewportWidth, kViewportHeight, 100.0, 100.0,
                  false, scratch, result).ok,
               "an unknown slot fails");
  test::expect(result.x == 7.0 && result.y == 9.0, "a failed call leaves the result untouched");
  test::expect(!snapPosition(document, spatial, camera, dragged, kViewportWidth, kViewportHeight, std::nan(""),
                             100.0, false, scratch, result)
                    .ok,
               "a non-finite x fails");
  test::expect(!snapPosition(document, spatial, camera, dragged, 0.0, kViewportHeight, 100.0, 100.0, false,
                             scratch, result)
                    .ok,
               "a non-positive viewport fails");

  // Stale spatial index: the document gained an object after the last rebuild.
  Document stale;
  SpatialIndex staleSpatial;
  const std::uint32_t staleDragged = add(stale, rectangle(100.0, 100.0, 80.0, 60.0, Layer::noteCards));
  staleSpatial.rebuild(stale);
  add(stale, rectangle(400.0, 300.0, 80.0, 60.0, Layer::blocks));
  SnapResult staleResult;
  test::expect(
      !snapPosition(stale, staleSpatial, camera, staleDragged, kViewportWidth, kViewportHeight, 100.0,
                    100.0, false, scratch, staleResult)
           .ok,
      "a stale spatial index fails");
}

}  // namespace

int main() {
  test::section("L07 snapping core");
  testEdgeAndCentre();
  testTolerance();
  testPrecedenceAndGrid();
  testShiftFree();
  testMaxThreeGuides();
  testExclusionAndVisibility();
  testInvalidInputs();
  if (test::failures != 0) {
    std::fprintf(stderr, "%d snap test failure(s)\n", test::failures);
    return 1;
  }
  std::printf("engine_snap_tests: all checks passed\n");
  return 0;
}
