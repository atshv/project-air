// Native tests of the L08 (P4-29) zone parity core.

#include "engine/zone_layout.h"

#include <cassert>
#include <cstdio>
#include <vector>

namespace zl = air::engine::zone_layout;

namespace {
int failures = 0;
void check(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "zone_layout_test: %s\n", message);
    failures += 1;
  }
}
}  // namespace

int main() {
  // Orientation: size-normalised offsets, 1.25 dominance, half-item hold.
  std::vector<zl::Member> sideBySide = {{100, 300, -120, 0, 0}, {300, 100, 120, 0, 1}};
  check(zl::orientation(sideBySide, zl::Orientation::vertical) == zl::Orientation::horizontal,
        "wide beside tall reads side by side");
  std::vector<zl::Member> stacked = {{300, 100, 0, -120, 0}, {100, 300, 0, 120, 1}};
  check(zl::orientation(stacked, zl::Orientation::horizontal) == zl::Orientation::vertical,
        "tall above short reads stacked");
  std::vector<zl::Member> diagonal = {{200, 200, 100, 90, 0}, {200, 200, -100, -90, 1}};
  check(zl::orientation(diagonal, zl::Orientation::horizontal) == zl::Orientation::horizontal,
        "near-diagonal keeps the current orientation");
  std::vector<zl::Member> held = {{200, 200, 10, 5, 0}, {200, 200, -10, -5, 1}};
  check(zl::orientation(held, zl::Orientation::vertical) == zl::Orientation::vertical,
        "a held item does not flip the orientation");

  // Order from the centre with the 12 px band.
  std::vector<zl::Member> members = {{100, 100, 0, 40, 0}, {100, 100, 0, -40, 1}, {100, 100, 0, 8, 2}};
  const auto ordered = zl::order(members, zl::Orientation::vertical);
  check(ordered[0].offsetY == -40.0 && ordered[1].offsetY == 8.0 && ordered[2].offsetY == 40.0,
        "order comes from the centre");
  std::vector<zl::Member> near = {{100, 100, 0, 30, 0}, {100, 100, 0, 24, 1}};
  const auto kept = zl::order(near, zl::Orientation::vertical);
  check(kept[0].order == 0 && kept[1].order == 1, "the 12 px band keeps the stored order");

  // Arrangement: padding, gap, header.
  std::vector<zl::Member> pair = {{200, 100, 0, 0, 0}, {160, 80, 0, 0, 1}};
  const zl::Arrangement vertical = zl::arrange(pair, zl::Orientation::vertical, 1000, 1000);
  check(!vertical.fallback, "the requested orientation fits");
  check(vertical.width == 200.0 + 2.0 * zl::kPadding, "frame width uses the padding");
  check(vertical.height == zl::kHeaderHeight + (100.0 + zl::kGap + 80.0) + 2.0 * zl::kPadding,
        "frame height uses header, gap and padding");
  check(vertical.placements[1].y == 100.0 + zl::kGap, "stacked gap is 12 px");
  const zl::Arrangement horizontal = zl::arrange(pair, zl::Orientation::horizontal, 1000, 1000);
  check(horizontal.placements[1].x == 200.0 + zl::kGap, "side-by-side gap is 12 px");

  // Fit fallback without changing the request.
  const zl::Arrangement fallback = zl::arrange(pair, zl::Orientation::horizontal, 250, 2000);
  check(fallback.fallback, "an arrangement that does not fit falls back");
  check(fallback.orientation == zl::Orientation::vertical, "the other orientation is used");

  // Preview: enter at 25 % coverage, stay with the 24 px catch margin, shrink on out.
  zl::PreviewInput input;
  input.frame = {100, 100, 400, 300};
  input.pointerX = 300;
  input.pointerY = 250;
  input.draggedWidth = 80;
  input.draggedHeight = 60;
  input.dragStartX = 300;
  input.dragStartY = 250;
  zl::PreviewState dock = zl::preview(input);
  check(dock.inside && dock.kind == zl::PreviewKind::dock, "pointer over the frame docks");
  input.pointerX = 900;
  input.pointerY = 900;
  input.coverage = zl::kEnterCoverage;
  zl::PreviewState covered = zl::preview(input);
  check(covered.inside, "25 % coverage enters");
  input.coverage = 0.0;
  input.previewing = true;
  input.zoom = 2.0;
  input.pointerX = 100 - 12 + 1;  // 24 screen px = 12 world px at zoom 2
  input.pointerY = 150;
  zl::PreviewState staying = zl::preview(input);
  check(staying.inside, "the 24 px catch margin keeps the dock");
  input.pointerX = 100 - 12 - 2;
  zl::PreviewState leaving = zl::preview(input);
  check(!leaving.inside && leaving.kind == zl::PreviewKind::detach, "leaving detaches");
  check(leaving.shrinking, "the frame shrinks around the staying member");

  if (failures != 0) {
    std::fprintf(stderr, "zone_layout_test: %d failure(s)\n", failures);
    return 1;
  }
  std::printf("zone_layout_test: OK\n");
  return 0;
}
