#include "engine/engine.h"

#include <string_view>

#include "contract.h"
#include "tokens.h"

namespace {

constexpr const char kEngineVersion[] = "0.1.0";

// The engine speaks exactly one contract version; a mismatch must not compile.
constexpr bool contractVersionMatches() {
  return std::string_view(project_air::contracts::kContractVersion) == "0.1.0";
}
static_assert(contractVersionMatches(),
              "contract.h must be generated for contract version 0.1.0");

// The generated token header is part of the engine's build surface (AD-7).
static_assert(tokens::canvas_grid > 0.0,
              "tokens.h must be generated and usable from C++");

}  // namespace

extern "C" const char* air_engine_version() { return kEngineVersion; }
