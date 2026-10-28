// P4-11 native stub tests: the WebGPU C entry points fail cleanly without a
// browser API and never crash; they keep the native suites green.

#include "engine/render_gl.h"

#include <cstdio>
#include <cstring>

namespace {
int failures = 0;
void check(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "render_webgpu_test: %s\n", message);
    failures += 1;
  }
}
bool hasReason() { return std::strlen(engine_last_error()) > 0; }
}  // namespace

int main() {
  check(engine_create_webgpu("#missing-canvas") == 0, "native create_webgpu fails");
  check(hasReason(), "native create_webgpu reports engine_last_error");

  check(engine_create_webgpu(nullptr) == 0, "a null selector fails cleanly");
  check(hasReason(), "the null selector has a reason");

  check(engine_render_webgpu_frame() == 0, "a frame before create fails cleanly");
  check(hasReason(), "the pre-create frame has a reason");

  check(engine_webgpu_ready() == -1, "readiness before create is -1");
  check(hasReason(), "the pre-create readiness has a reason");

  // The WebGL2 entry point stays untouched: it fails for the same missing canvas
  // with its own message (no WebGPU claim leaks into it).
  check(engine_create("#missing-canvas") == 0, "engine_create still fails without a canvas");
  check(hasReason(), "engine_create reports its own reason");

  if (failures != 0) {
    std::fprintf(stderr, "render_webgpu_test: %d failure(s)\n", failures);
    return 1;
  }
  std::printf("render_webgpu_test: OK\n");
  return 0;
}
