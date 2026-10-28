#pragma once

// L08 (P4-27) zone drop highlight: presentation-only state of the chrome pass.
//
// A successful drop into a zone highlights that zone for one second in
// tokens::accent_line. The state is a slot plus the time it started; it is never
// board content, an operation payload or a command-buffer instance. Time is
// injected so the native unit suite can test the one-second expiry without a
// clock or a GL context.

#include <cstdint>

namespace air::engine {

// The highlight duration from L08: one second (no design token carries a time
// value for it; the colour comes from tokens::accent_line).
inline constexpr double kZoneHighlightSeconds = 1.0;

class ZoneHighlightState {
 public:
  // Starts a highlight for one live slot at `nowSeconds`; a previous highlight
  // is replaced. Negative slots clear the state.
  void show(int slot, double nowSeconds) {
    if (slot < 0 || !(nowSeconds > -1.0e300) || nowSeconds != nowSeconds) {
      slot_ = kNoHighlight;
      started_ = 0.0;
      return;
    }
    slot_ = slot;
    started_ = nowSeconds;
  }

  // Clears the highlight (document reload, explicit clear).
  void clear() {
    slot_ = kNoHighlight;
    started_ = 0.0;
  }

  // The highlighted slot, or kNoHighlight.
  int slot() const { return slot_; }

  // True while the highlight is active at `nowSeconds` (strictly before the one
  // second elapsed).
  bool visible(double nowSeconds) const {
    return slot_ != kNoHighlight && nowSeconds >= started_ &&
           nowSeconds - started_ < kZoneHighlightSeconds;
  }

  // Remaining highlight time at `nowSeconds`, clamped to [0, 1].
  double remaining(double nowSeconds) const {
    if (!visible(nowSeconds)) {
      return 0.0;
    }
    const double left = kZoneHighlightSeconds - (nowSeconds - started_);
    return left < 0.0 ? 0.0 : left;
  }

  static constexpr int kNoHighlight = -1;

 private:
  int slot_{kNoHighlight};
  double started_{0.0};
};

}  // namespace air::engine
