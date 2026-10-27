#pragma once

#include "engine/geometry.h"
#include "engine/status.h"

namespace air::engine {

// Result of Camera::fitBounds: the pan and zoom that show a world rectangle in a
// viewport. The pan follows the camera convention below; the zoom is already
// clamped into the fit range.
struct ViewFit {
  double panX{0.0};
  double panY{0.0};
  double zoom{1.0};
};

// Camera convention (documented for the TypeScript bridge and the renderer):
//   panX/panY  world point shown at the viewport's top-left corner (screen origin)
//   zoom       screen pixels per world pixel
//   u = (x - panX) * zoom,   v = (y - panY) * zoom
// Screen space is the canvas's CSS pixels, origin top-left, y down; it matches
// the contract's world coordinate orientation. The spike limits 0.1 and 8 are
// provisional interaction values, not design tokens.
//
// Mutators validate their input and return a Status: a non-finite value is
// rejected and leaves the camera untouched, so a NaN transform can never reach
// the spatial index or the command buffer.
class Camera {
 public:
  static constexpr double kMinZoom = 0.1;
  static constexpr double kMaxZoom = 8.0;
  // L19: "show all" never zooms past 100 %.
  static constexpr double kMaxFitZoom = 1.0;
  // L19: the dot grid is chrome and is hidden below this zoom; at or above it the
  // grid is visible (canvas catalogue L19: "hides below zoom 0.5"). The boundary
  // is defined here, tested and documented in docs/engine.md.
  static constexpr double kGridMinZoom = 0.5;

  double panX() const { return panX_; }
  double panY() const { return panY_; }
  double zoom() const { return zoom_; }

  Status setPan(double panX, double panY);

  // Sets pan and zoom atomically: a rejected value leaves both untouched.
  // The zoom is clamped to [kMinZoom, kMaxZoom] after validation.
  Status setView(double panX, double panY, double zoom);

  // Moves the content with the pointer: a screen-space drag delta pans the view.
  // Rejects a drag that would overflow the pan to a non-finite value.
  Status panByScreen(double deltaX, double deltaY);

  // Clamps to [kMinZoom, kMaxZoom]; rejects non-finite input.
  Status setZoom(double zoom);

  Point worldToScreen(Point point) const;
  Point screenToWorld(Point point) const;

  // World rectangle covered by a viewport of the given screen size.
  Bounds visibleWorldBounds(double viewportWidth, double viewportHeight) const;

  // 16 px canvas grid from packages/ui-kit/tokens.h (design-rules §3 and §13).
  static double gridSize();
  static double snapToGrid(double value);

  // L19: true when the dot grid is drawn at `zoom` (at or above kGridMinZoom). A
  // non-finite zoom is treated as "not visible".
  static bool gridVisibleAtZoom(double zoom);

  // L02 / design-rules §9: "show all" keeps at least 64 px (bar 48 px + 16 px)
  // free at the top so the bar never covers a card; both values are tokens.
  static double fitTopPadding();

  // Fits a world rectangle (the board's world bounds) into a viewport (L19):
  //   zoom = min(viewportWidth / bounds.width, (viewportHeight - top padding) /
  //              bounds.height, kMaxFitZoom), clamped to [kMinZoom, kMaxFitZoom];
  //   the content is centred horizontally in the viewport and vertically in the
  //   area below the top padding, so at least fitTopPadding() pixels stay free
  //   above it whenever the minimum zoom does not crop the content.
  // Empty or invalid bounds (zero, negative or non-finite area) frame the world
  // origin at kMaxFitZoom: pan 0/0, zoom 1, no division by zero and no NaN.
  // A non-positive or non-finite viewport is rejected and leaves `view` untouched.
  static Status fitBounds(const Bounds& bounds, double viewportWidth, double viewportHeight,
                          ViewFit& view);

 private:
  double panX_{0.0};
  double panY_{0.0};
  double zoom_{1.0};
};

}  // namespace air::engine
