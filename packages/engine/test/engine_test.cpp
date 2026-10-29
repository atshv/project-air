#include <cstdio>
#include <string_view>

#include "contract.h"
#include "engine/engine.h"
#include "tokens.h"

namespace {

int failures = 0;

void expect(bool condition, const char* description) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", description);
    ++failures;
  }
}

}  // namespace

int main() {
  expect(std::string_view(air_engine_version()) == "0.1.0",
         "air_engine_version() returns 0.1.0");
  expect(std::string_view(project_air::contracts::kContractVersion) == "0.4.0",
         "generated contract version is 0.4.0");
  expect(__cplusplus >= 202002L, "the engine is compiled as C++20");
  expect(tokens::canvas_grid > 0.0, "the generated token header is usable from C++");

  if (failures != 0) {
    std::fprintf(stderr, "engine_unit_tests: %d check(s) failed\n", failures);
    return 1;
  }

  std::puts("engine_unit_tests: all checks passed");
  return 0;
}
