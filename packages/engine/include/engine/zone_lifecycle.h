#pragma once

// L08 (P4-30) zone lifecycle and names core (native mirror of the TS rules):
// grouping thresholds, the default title per playground language, the rename
// rules and the fixed 40 px header geometry. Pure; pinned by the native suite.

#include <cstddef>
#include <string>
#include <vector>

#include "tokens.h"

namespace air::engine::zone_lifecycle {

inline constexpr double kGroupOverlap = 0.20;
inline constexpr double kGroupPointerPx = 16.0;
inline constexpr double kGroupContactPx = 32.0;
inline constexpr double kHeaderHeight = tokens::header_height;
inline constexpr std::size_t kTitleMax = 40;

enum class Language { en, de };

inline const char* defaultTitle(Language language) {
  return language == Language::de ? "Neue Zone" : "New zone";
}

// Whitespace collapsed and trimmed; empty -> default; at most 40 code points.
inline std::string normalizeTitle(const std::string& raw, Language language) {
  std::string collapsed;
  bool pendingSpace = false;
  for (const char character : raw) {
    const bool space = character == ' ' || character == '\t' || character == '\n' ||
                       character == '\r' || character == '\f' || character == '\v';
    if (space) {
      pendingSpace = !collapsed.empty();
      continue;
    }
    if (pendingSpace) {
      collapsed.push_back(' ');
      pendingSpace = false;
    }
    collapsed.push_back(character);
  }
  const std::size_t length = collapsed.size() < kTitleMax ? collapsed.size() : kTitleMax;
  const std::string limited = collapsed.substr(0, length);
  return limited.empty() ? std::string(defaultTitle(language)) : limited;
}

struct GroupingDecision {
  bool start{false};
  bool keep{false};
};

// 20 % overlap or 16 px pointer distance starts; 32 px contact keeps an active
// ghost (screen px, zoom-independent by the caller).
inline GroupingDecision grouping(double overlap, double pointerDistancePx, double contactPx,
                                 bool active) {
  GroupingDecision decision;
  const bool start = overlap >= kGroupOverlap || pointerDistancePx <= kGroupPointerPx;
  const bool keep = active && contactPx <= kGroupContactPx;
  decision.start = start || keep;
  decision.keep = keep;
  return decision;
}

struct FrameLook {
  bool dashed{false};
  bool dimmed{false};
};

inline FrameLook frameLook(bool groupingActive, int memberCount, bool lastMemberLeaving) {
  const bool emptying = memberCount == 0 || lastMemberLeaving;
  return FrameLook{groupingActive || emptying, emptying};
}

// The 40 px header band is independent of any frame scale (the FLIP resize
// never stretches the title).
inline double headerHeight(double scale) {
  (void)scale;
  return kHeaderHeight;
}

}  // namespace air::engine::zone_lifecycle
