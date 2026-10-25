#pragma once

namespace air::engine {

// Lightweight result for bridge-safe error reporting: the engine never lets an
// exception cross the C ABI, so recoverable failures return a Status with a
// static reason string.
struct Status {
  bool ok{true};
  const char* reason{nullptr};

  static Status success() { return {}; }

  static Status failure(const char* reason) { return {false, reason}; }

  explicit operator bool() const { return ok; }
};

}  // namespace air::engine
