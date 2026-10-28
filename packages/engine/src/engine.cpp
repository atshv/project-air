#include "engine/engine.h"

#include <string_view>

#include "contract.h"
#include "engine/camera.h"
#include "tokens.h"

namespace {

constexpr const char kEngineVersion[] = "0.1.0";

// The engine speaks exactly one contract version; a mismatch must not compile.
constexpr bool contractVersionMatches() {
  return std::string_view(project_air::contracts::kContractVersion) == "0.3.0";
}
static_assert(contractVersionMatches(),
              "contract.h must be generated for contract version 0.3.0");

// The generated token header is part of the engine's build surface (AD-7).
static_assert(tokens::canvas_grid > 0.0,
              "tokens.h must be generated and usable from C++");

}  // namespace

extern "C" const char* air_engine_version() { return kEngineVersion; }

extern "C" int engine_fit_view(double bounds_x, double bounds_y, double bounds_width,
                               double bounds_height, double viewport_width,
                               double viewport_height, double* out_pan_zoom) {
  if (out_pan_zoom == nullptr) {
    return 0;
  }
  air::engine::ViewFit fitted;
  const air::engine::Status status = air::engine::Camera::fitBounds(
      air::engine::Bounds{bounds_x, bounds_y, bounds_width, bounds_height}, viewport_width,
      viewport_height, fitted);
  if (!status) {
    return 0;
  }
  out_pan_zoom[0] = fitted.panX;
  out_pan_zoom[1] = fitted.panY;
  out_pan_zoom[2] = fitted.zoom;
  return 1;
}
