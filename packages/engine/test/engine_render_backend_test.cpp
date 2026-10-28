// P4-12 native stub tests: backend selection/reason entry points fail cleanly
// without a browser API and never crash.

#include "engine/render_gl.h"

#include <cstdio>
#include <cstring>

namespace {
int failures = 0;
void check(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "render_backend_test: %s\n", message);
    failures += 1;
  }
}
bool hasReason() { return std::strlen(engine_last_error()) > 0; }
}  // namespace

int main() {
  check(engine_active_backend() == 0, "no backend before creation");
  check(engine_backend_reason() == -1, "no reason before creation");

  check(engine_set_backend_reason(2) == 0, "setting a reason before a backend fails");
  check(hasReason(), "the pre-create reason failure is reported");
  check(engine_set_backend_reason(99) == 0, "an out-of-range reason fails");
  check(hasReason(), "the out-of-range reason failure is reported");

  // Abandoning WebGPU in a native build is a clean no-op: it must not crash and
  // must not claim a backend.
  check(engine_abandon_webgpu() == 0, "native abandon_webgpu fails cleanly");
  check(hasReason(), "native abandon_webgpu leaves an engine_last_error");
  check(engine_active_backend() == 0, "still no active backend after abandon");

  if (failures != 0) {
    std::fprintf(stderr, "render_backend_test: %d failure(s)\n", failures);
    return 1;
  }
  std::printf("render_backend_test: OK\n");
  return 0;
}
