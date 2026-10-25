#pragma once

#include <cstdint>
#include <cstdio>
#include <string>
#include <string_view>

namespace air::engine::test {

inline int failures = 0;

inline void expect(bool condition, std::string_view description) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %.*s\n", static_cast<int>(description.size()),
                 description.data());
    ++failures;
  }
}

inline void expectNear(double actual, double expected, double tolerance,
                       std::string_view description) {
  const double difference = actual > expected ? actual - expected : expected - actual;
  if (!(difference <= tolerance)) {
    std::fprintf(stderr, "FAIL: %.*s (actual %.17g, expected %.17g)\n",
                 static_cast<int>(description.size()), description.data(), actual, expected);
    ++failures;
  }
}

inline void section(std::string_view name) {
  std::printf("- %.*s\n", static_cast<int>(name.size()), name.data());
}

// Deterministic pseudo-random generator: tests never depend on random_device, so
// a failing seed is reproducible.
class Lcg {
 public:
  explicit Lcg(std::uint64_t seed = 0x9e3779b97f4a7c15ULL) : state_(seed) {}

  std::uint32_t next() {
    state_ = state_ * 6364136223846793005ULL + 1442695040888963407ULL;
    return static_cast<std::uint32_t>(state_ >> 33U);
  }

  double unit() { return static_cast<double>(next()) / 4294967295.0; }

 private:
  std::uint64_t state_;
};

// Fixed-width decimal key: lexicographic order equals numeric order.
inline std::string fracKey(std::uint32_t value) {
  char buffer[16];
  std::snprintf(buffer, sizeof(buffer), "%08u", value);
  return std::string(buffer);
}

}  // namespace air::engine::test
