// Native unit tests of the L08 zone drop highlight state (P4-27).

#include "engine/zone_highlight.h"

#include <cassert>
#include <cstdio>

namespace {

int failures = 0;

void check(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "zone_highlight_test: %s\n", message);
    failures += 1;
  }
}

}  // namespace

int main() {
  air::engine::ZoneHighlightState state;
  check(!state.visible(0.0), "an empty state has no highlight");
  check(state.slot() == air::engine::ZoneHighlightState::kNoHighlight, "no slot initially");

  state.show(7, 10.0);
  check(state.slot() == 7, "the drop stores the zone slot");
  check(state.visible(10.0), "visible immediately after the drop");
  check(state.visible(10.5), "visible halfway through the second");
  check(!state.visible(11.0), "the highlight expires after one second");
  check(!state.visible(10.9999) == false, "just before the second it is still visible");
  check(state.remaining(10.25) > 0.7 && state.remaining(10.25) < 0.76, "remaining time counts down");
  check(state.remaining(11.5) == 0.0, "expired remaining is zero");

  state.show(9, 20.0);
  check(state.slot() == 9, "a new drop replaces the highlighted zone");
  check(state.visible(20.2), "the new highlight is visible");

  state.clear();
  check(state.slot() == air::engine::ZoneHighlightState::kNoHighlight, "clear removes the slot");
  check(!state.visible(20.2), "clear ends the highlight");

  state.show(-1, 30.0);
  check(state.slot() == air::engine::ZoneHighlightState::kNoHighlight, "negative slots clear");
  state.show(3, 0.0 / 0.0);
  check(state.slot() == air::engine::ZoneHighlightState::kNoHighlight, "NaN time clears");

  if (failures != 0) {
    std::fprintf(stderr, "zone_highlight_test: %d failure(s)\n", failures);
    return 1;
  }
  std::printf("zone_highlight_test: OK\n");
  return 0;
}
