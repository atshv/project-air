#pragma once

namespace air::engine {

// World or screen coordinates in pixels. The camera converts between the two
// spaces; see camera.h for the exact convention.
struct Point {
  double x{0.0};
  double y{0.0};
};

// Axis-aligned rectangle in world or screen space, origin top-left, y down.
struct Bounds {
  double x{0.0};
  double y{0.0};
  double width{0.0};
  double height{0.0};

  double right() const { return x + width; }
  double bottom() const { return y + height; }

  // Touching edges count as intersecting; a zero-size rectangle inside `other`
  // is therefore contained.
  bool intersects(const Bounds& other) const {
    return x <= other.right() && other.x <= right() && y <= other.bottom() &&
           other.y <= bottom();
  }

  bool contains(const Point& point) const {
    return x <= point.x && point.x <= right() && y <= point.y && point.y <= bottom();
  }
};

}  // namespace air::engine
