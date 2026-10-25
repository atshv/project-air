#pragma once

#include "engine/geometry.h"
#include "engine/status.h"

namespace air::engine {

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

 private:
  double panX_{0.0};
  double panY_{0.0};
  double zoom_{1.0};
};

}  // namespace air::engine
