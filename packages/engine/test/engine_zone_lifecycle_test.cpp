#include "engine/zone_lifecycle.h"

#include <cstdio>

namespace zl = air::engine::zone_lifecycle;
namespace {
int failures = 0;
void check(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "zone_lifecycle_test: %s\n", message);
    failures += 1;
  }
}
}  // namespace

int main() {
  const zl::GroupingDecision idle = zl::grouping(0.19, 17.0, 10.0, false);
  check(!idle.start, "below both start thresholds stays idle");
  check(zl::grouping(0.20, 100.0, 10.0, false).start, "20 % overlap starts grouping");
  check(zl::grouping(0.0, 16.0, 10.0, false).start, "16 px pointer distance starts grouping");
  check(zl::grouping(0.0, 100.0, 31.0, true).keep, "32 px contact keeps the ghost");
  check(!zl::grouping(0.0, 100.0, 33.0, true).keep, "beyond 32 px the ghost ends");

  const zl::FrameLook grouping = zl::frameLook(true, 2, false);
  check(grouping.dashed && !grouping.dimmed, "grouping shows a dashed ghost frame");
  const zl::FrameLook emptied = zl::frameLook(false, 0, false);
  check(emptied.dashed && emptied.dimmed, "an emptied zone is dashed and dimmed");
  const zl::FrameLook normal = zl::frameLook(false, 2, false);
  check(!normal.dashed && !normal.dimmed, "a filled zone is a solid frame");

  check(std::string(zl::defaultTitle(zl::Language::en)) == "New zone", "English default title");
  check(std::string(zl::defaultTitle(zl::Language::de)) == "Neue Zone", "German default title");
  check(zl::normalizeTitle("  Lake   trip  ", zl::Language::en) == "Lake trip", "whitespace collapsed");
  check(zl::normalizeTitle("   ", zl::Language::de) == "Neue Zone", "empty title uses the default");
  std::string longTitle(60, 'x');
  check(zl::normalizeTitle(longTitle, zl::Language::en).size() == zl::kTitleMax, "40 character limit");
  check(zl::kTitleMax == 40, "the title limit is 40 characters");

  check(zl::headerHeight(0.5) == 40.0 && zl::headerHeight(1.0) == 40.0 && zl::headerHeight(2.0) == 40.0,
        "the header never scales with the frame");

  if (failures != 0) {
    std::fprintf(stderr, "zone_lifecycle_test: %d failure(s)\n", failures);
    return 1;
  }
  std::printf("zone_lifecycle_test: OK\n");
  return 0;
}
