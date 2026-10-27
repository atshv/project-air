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

Status Camera::setView(double panX, double panY, double zoom) {
  if (!std::isfinite(panX) || !std::isfinite(panY) || !std::isfinite(zoom)) {
    return Status::failure("camera pan and zoom must be finite");
  }
  panX_ = panX;
  panY_ = panY;
  zoom_ = std::clamp(zoom, kMinZoom, kMaxZoom);
  return Status::success();
}

Status Camera::panByScreen(double deltaX, double deltaY) {
  if (!std::isfinite(deltaX) || !std::isfinite(deltaY)) {
    return Status::failure("camera drag delta must be finite");
  }
  const double nextPanX = panX_ - deltaX / zoom_;
  const double nextPanY = panY_ - deltaY / zoom_;
  if (!std::isfinite(nextPanX) || !std::isfinite(nextPanY)) {
    return Status::failure("camera pan would become non-finite");
  }
  panX_ = nextPanX;
  panY_ = nextPanY;
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

bool Camera::gridVisibleAtZoom(double zoom) {
  // L19: hidden below 0.5, visible at and above it; a non-finite zoom never
  // reaches the threshold, so it stays hidden instead of propagating NaN.
  return std::isfinite(zoom) && zoom >= kGridMinZoom;
}

double Camera::fitTopPadding() {
  // 48 px bar + 16 px gap (design-rules §9, L02), both from the token header.
  return tokens::space_48 + tokens::space_16;
}

Status Camera::fitBounds(const Bounds& bounds, double viewportWidth, double viewportHeight,
                         ViewFit& view) {
  if (!std::isfinite(viewportWidth) || !std::isfinite(viewportHeight) || viewportWidth <= 0.0 ||
      viewportHeight <= 0.0) {
    return Status::failure("fit needs a positive, finite viewport");
  }
  const double topPadding = fitTopPadding();
  // Empty or invalid bounds are an explicit "nothing to frame" case: the world
  // origin is shown at 100 %, which keeps a single card and an empty document
  // deterministic and avoids a division by zero or a NaN pan.
  const bool hasContent = std::isfinite(bounds.x) && std::isfinite(bounds.y) &&
                          std::isfinite(bounds.width) && std::isfinite(bounds.height) &&
                          bounds.width > 0.0 && bounds.height > 0.0;
  if (!hasContent) {
    view = ViewFit{0.0, 0.0, kMaxFitZoom};
    return Status::success();
  }
  // Fit into the viewport below the top padding and never past 100 %. When the raw
  // fit needs less than the camera minimum the zoom stays at kMinZoom and the
  // content is cropped; the padding then cannot hold either, which is documented.
  const double availableHeight = std::max(viewportHeight - topPadding, 0.0);
  const double rawZoom = std::min({viewportWidth / bounds.width,
                                   availableHeight / bounds.height, kMaxFitZoom});
  const double zoom = std::clamp(rawZoom, kMinZoom, kMaxFitZoom);
  // Centre the content horizontally in the viewport and vertically in the area
  // below the padding; the pan is the world point at the top-left screen corner.
  const double contentScreenLeft = (viewportWidth - bounds.width * zoom) / 2.0;
  const double contentScreenTop =
      topPadding + (availableHeight - bounds.height * zoom) / 2.0;
  ViewFit fitted;
  fitted.zoom = zoom;
  fitted.panX = bounds.x - contentScreenLeft / zoom;
  fitted.panY = bounds.y - contentScreenTop / zoom;
  view = fitted;
  return Status::success();
}

}  // namespace air::engine
