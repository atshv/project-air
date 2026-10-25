#include "engine/camera.h"

#include <algorithm>
#include <cmath>

#include "tokens.h"

namespace air::engine {

Status Camera::setPan(double panX, double panY) {
  if (!std::isfinite(panX) || !std::isfinite(panY)) {
    return Status::failure("camera pan must be finite");
  }
  panX_ = panX;
  panY_ = panY;
  return Status::success();
}

Status Camera::panByScreen(double deltaX, double deltaY) {
  if (!std::isfinite(deltaX) || !std::isfinite(deltaY)) {
    return Status::failure("camera drag delta must be finite");
  }
  panX_ -= deltaX / zoom_;
  panY_ -= deltaY / zoom_;
  return Status::success();
}

Status Camera::setZoom(double zoom) {
  if (!std::isfinite(zoom)) {
    return Status::failure("camera zoom must be finite");
  }
  zoom_ = std::clamp(zoom, kMinZoom, kMaxZoom);
  return Status::success();
}

Point Camera::worldToScreen(Point point) const {
  return {(point.x - panX_) * zoom_, (point.y - panY_) * zoom_};
}

Point Camera::screenToWorld(Point point) const {
  return {point.x / zoom_ + panX_, point.y / zoom_ + panY_};
}

Bounds Camera::visibleWorldBounds(double viewportWidth, double viewportHeight) const {
  return {panX_, panY_, viewportWidth / zoom_, viewportHeight / zoom_};
}

double Camera::gridSize() { return tokens::canvas_grid; }

double Camera::snapToGrid(double value) {
  const double grid = gridSize();
  return std::round(value / grid) * grid;
}

}  // namespace air::engine
