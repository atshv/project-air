#!/usr/bin/env bash
# Build the engine WebAssembly module with the pinned Emscripten toolchain.
#
# Emscripten's launchers start their own Python (>= 3.10), and CMake calls the
# libexec launcher directly, so a bare `emcmake` can resolve python3 from PATH
# and pick up the macOS system Python 3.9. When Homebrew provides Emscripten this
# wrapper prepends Homebrew's Emscripten bin and brew bin (Python 3.15, cmake);
# otherwise it trusts emcc/emcmake on PATH, which is how CI runs the pinned
# emsdk installation (docs/versions.md).
#
# Usage (repository root): bash packages/engine/tools/build-wasm.sh

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${PACKAGE_DIR}/build-wasm"

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi
  local candidate
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

EMSCRIPTEN_PREFIX=""
if BREW="$(find_brew)"; then
  EMSCRIPTEN_PREFIX="$("${BREW}" --prefix emscripten 2>/dev/null || true)"
fi

if [[ -n "${EMSCRIPTEN_PREFIX}" ]]; then
  BREW_PREFIX="$("${BREW}" --prefix 2>/dev/null || true)"
  if [[ -n "${BREW_PREFIX}" ]]; then
    PATH="${BREW_PREFIX}/bin:${PATH}"
  fi
  PATH="${EMSCRIPTEN_PREFIX}/bin:${PATH}"
  export PATH
  printf 'build-wasm: Emscripten from Homebrew at %s\n' "${EMSCRIPTEN_PREFIX}"
else
  # Homebrew's layout is used directly when `brew` itself cannot run (e.g. no HOME).
  for prefix in /opt/homebrew /usr/local; do
    if [[ -x "${prefix}/opt/emscripten/bin/emcmake" ]]; then
      PATH="${prefix}/bin:${prefix}/opt/emscripten/bin:${PATH}"
      export PATH
      printf 'build-wasm: Emscripten from %s/opt/emscripten\n' "${prefix}"
      break
    fi
  done
fi

if ! command -v emcmake >/dev/null 2>&1; then
  printf 'build-wasm: emcmake not found; install the pinned Emscripten toolchain (docs/versions.md)\n' >&2
  exit 1
fi

emcmake cmake -S "${PACKAGE_DIR}" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" --parallel

# packages/engine/package.json declares "type": "module", which would make Node
# treat the generated engine.js as ESM. Tag the build output as CommonJS so the
# classic browser script loader and the documented Node require check both work.
printf '{ "type": "commonjs" }\n' > "${BUILD_DIR}/package.json"
