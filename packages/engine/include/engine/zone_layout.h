#pragma once

// L08 (P4-29) zone parity core: pure arrangement and release-preview rules,
// mirrored from the playground's TS rules with the same tokens and thresholds.
// No GL, no document access; the native unit suite pins orientation, order, the
// fit fallback and the enter/stay hysteresis.

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

#include "tokens.h"

namespace air::engine::zone_layout {

inline constexpr double kPadding = tokens::space_16;
inline constexpr double kGap = tokens::space_12;
inline constexpr double kHeaderHeight = tokens::header_height;
inline constexpr double kDominance = 1.25;
inline constexpr double kHold = 0.5;
inline constexpr double kOrderBand = 12.0;
inline constexpr double kEnterCoverage = 0.25;
inline constexpr double kCatchMargin = 24.0;
inline constexpr double kSettleSeconds = 0.30;
inline constexpr double kLiftScale = 1.02;
inline constexpr const char* kSettleCurve = "cubic-bezier(0.2, 0, 0, 1)";

enum class Orientation { vertical, horizontal };

struct Member {
  double width{0.0};
  double height{0.0};
  double offsetX{0.0};  // member-centre offset from the zone centre, world px
  double offsetY{0.0};
  int order{0};
};

struct Rect {
  double x{0.0};
  double y{0.0};
  double width{0.0};
  double height{0.0};
};

struct Arrangement {
  Orientation orientation{Orientation::vertical};
  bool fallback{false};
  double width{0.0};
  double height{0.0};
  std::vector<Rect> placements;  // relative to the frame origin, in order
};

// Orientation from the size-normalised centre spread: 1.25 dominance, half-item
// hold, otherwise keep the current orientation.
inline Orientation orientation(const std::vector<Member>& members, Orientation current) {
  if (members.size() < 2) {
    return current;
  }
  double minX = members[0].offsetX;
  double maxX = members[0].offsetX;
  double minY = members[0].offsetY;
  double maxY = members[0].offsetY;
  double widthSum = 0.0;
  double heightSum = 0.0;
  for (const Member& member : members) {
    minX = std::min(minX, member.offsetX);
    maxX = std::max(maxX, member.offsetX);
    minY = std::min(minY, member.offsetY);
    maxY = std::max(maxY, member.offsetY);
    widthSum += member.width;
    heightSum += member.height;
  }
  const double count = static_cast<double>(members.size());
  const double nx = (maxX - minX) / std::max(1.0, widthSum / count);
  const double ny = (maxY - minY) / std::max(1.0, heightSum / count);
  if (std::max(nx, ny) < kHold) {
    return current;
  }
  if (nx >= kDominance * ny) {
    return Orientation::horizontal;
  }
  if (ny >= kDominance * nx) {
    return Orientation::vertical;
  }
  return current;
}

// Member order from the centre with the 12 px band (stable for near-equal
// centres, so the stored order wins inside the band).
inline std::vector<Member> order(const std::vector<Member>& members, Orientation orientation) {
  std::vector<Member> sorted = members;
  std::stable_sort(sorted.begin(), sorted.end(), [orientation](const Member& left,
                                                               const Member& right) {
    const double axisLeft = orientation == Orientation::horizontal ? left.offsetX : left.offsetY;
    const double axisRight = orientation == Orientation::horizontal ? right.offsetX : right.offsetY;
    const double difference = axisLeft - axisRight;
    if (std::fabs(difference) <= kOrderBand) {
      return left.order < right.order;
    }
    return difference < 0.0;
  });
  return sorted;
}

// Sizes + padding + gap below the header; when the requested orientation does
// not fit, the other one is used and reported as a fallback (the caller's stored
// request is never changed here).
inline Arrangement arrange(const std::vector<Member>& members, Orientation requested,
                           double availableWidth, double availableHeight) {
  const std::vector<Member> ordered = order(members, requested);
  const auto layout = [&ordered](Orientation candidate) {
    Arrangement result;
    result.orientation = candidate;
    result.placements.reserve(ordered.size());
    double contentWidth = 0.0;
    double contentHeight = 0.0;
    double cursor = 0.0;
    for (const Member& member : ordered) {
      Rect placement;
      if (candidate == Orientation::vertical) {
        placement.y = cursor;
        cursor += member.height + kGap;
        contentWidth = std::max(contentWidth, member.width);
        contentHeight += member.height + kGap;
      } else {
        placement.x = cursor;
        cursor += member.width + kGap;
        contentHeight = std::max(contentHeight, member.height);
        contentWidth += member.width + kGap;
      }
      placement.width = member.width;
      placement.height = member.height;
      result.placements.push_back(placement);
    }
    if (!ordered.empty()) {
      if (candidate == Orientation::vertical) {
        contentHeight -= kGap;
      } else {
        contentWidth -= kGap;
      }
    }
    result.width = contentWidth + 2.0 * kPadding;
    result.height = kHeaderHeight + contentHeight + 2.0 * kPadding;
    return result;
  };
  Arrangement preferred = layout(requested);
  const bool tooWide = availableWidth > 0.0 && preferred.width > availableWidth + 0.5;
  const bool tooTall = availableHeight > 0.0 && preferred.height > availableHeight + 0.5;
  if (tooWide || tooTall) {
    Arrangement fallback =
        layout(requested == Orientation::vertical ? Orientation::horizontal : Orientation::vertical);
    fallback.fallback = true;
    return fallback;
  }
  return preferred;
}

enum class PreviewKind { dock, reorder, orientation, detach, free };

struct PreviewInput {
  Rect frame;
  double pointerX{0.0};
  double pointerY{0.0};
  double draggedWidth{0.0};
  double draggedHeight{0.0};
  double dragStartX{0.0};
  double dragStartY{0.0};
  bool previewing{false};
  double coverage{0.0};
  Orientation currentOrientation{Orientation::vertical};
  Orientation desiredOrientation{Orientation::vertical};
  double zoom{1.0};
};

struct PreviewState {
  PreviewKind kind{PreviewKind::free};
  bool inside{false};
  bool shrinking{false};
  bool makeRoom{false};
  Rect landing{};
  bool hasLanding{false};
};

inline bool insideWithMargin(double x, double y, const Rect& frame, double margin) {
  return x >= frame.x - margin && x <= frame.x + frame.width + margin &&
         y >= frame.y - margin && y <= frame.y + frame.height + margin;
}

// Enter at the frame or 25 % coverage; stay with the 24 px catch margin (screen
// px converted by the zoom); leaving shrinks the frame around the staying member.
inline PreviewState preview(const PreviewInput& input) {
  PreviewState state;
  const double margin = kCatchMargin / std::max(0.0001, input.zoom);
  const bool insideFrame = insideWithMargin(input.pointerX, input.pointerY, input.frame, 0.0);
  const bool catchInside =
      input.previewing && insideWithMargin(input.pointerX, input.pointerY, input.frame, margin);
  state.inside = insideFrame || input.coverage >= kEnterCoverage || catchInside;
  if (!state.inside) {
    state.kind = input.previewing ? PreviewKind::detach : PreviewKind::free;
    state.shrinking = true;
    return state;
  }
  state.landing = Rect{input.pointerX - input.draggedWidth / 2.0,
                       input.pointerY - input.draggedHeight / 2.0, input.draggedWidth,
                       input.draggedHeight};
  state.hasLanding = true;
  if (input.desiredOrientation != input.currentOrientation) {
    state.kind = PreviewKind::orientation;
    state.makeRoom = true;
    return state;
  }
  const bool moved = std::fabs(input.pointerX - input.dragStartX) > kOrderBand ||
                     std::fabs(input.pointerY - input.dragStartY) > kOrderBand;
  state.kind = moved ? PreviewKind::reorder : PreviewKind::dock;
  state.makeRoom = moved;
  return state;
}

}  // namespace air::engine::zone_layout
