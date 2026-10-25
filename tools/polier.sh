#!/usr/bin/env bash
#
# Pinned Polier for local sessions and CI.
#
# The version always comes from board.json ("generator_version"); nothing is hard-coded here.
# --check only reads the checkout (no network, no writes); --install clones the exact tag and is
# used by CI. The Polier checkout never lands in this repository.
#
set -euo pipefail

readonly POLIER_REMOTE="https://github.com/atshv/Polier.git"
readonly POLIER_HOME="${HOME}/.polier"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
BOARD="${REPO_ROOT}/board.json"

usage() {
  cat <<'EOF'
Usage: tools/polier.sh <command> [dir]

Commands:
  --check            verify that $POLIER is the board's generator_version at the exact tag
  --install [dir]    clone tag v<version> from the Polier repository into dir
                     (default: $HOME/.polier/<version>) and print the path
  --show             print the resolved checkout and the board's generator_version
  --help             show this help

Exit codes: 0 ok, 1 check failed, 2 usage error.
The version comes from board.json ("generator_version"); CI and local sessions use the same tag.
EOF
}

die_usage() {
  printf 'polier.sh: %s\n' "$1" >&2
  usage >&2
  exit 2
}

die_check() {
  printf 'polier.sh: %s\n' "$1" >&2
  exit 1
}

install_hint() {
  printf 'Install a pinned checkout with:\n  export POLIER="$(bash tools/polier.sh --install)"\n' >&2
}

require_board() {
  [ -f "${BOARD}" ] || die_check "board.json not found at ${BOARD}"
}

board_version() {
  python3 - "${BOARD}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    board = json.load(handle)
version = board.get("generator_version")
if not isinstance(version, str) or version == "":
    raise SystemExit("polier.sh: board.json has no generator_version")
print(version)
PY
}

read_version() {
  tr -d '[:space:]' < "$1"
}

# Verify one checkout against the expected version and (when it is a git checkout) the exact tag.
check_checkout() {
  local dir="$1"
  local expected="$2"
  local found
  local tag

  if [ ! -d "${dir}" ]; then
    printf "polier.sh: checkout '%s' does not exist.\n" "${dir}" >&2
    install_hint
    exit 1
  fi
  if [ ! -f "${dir}/VERSION" ]; then
    printf "polier.sh: checkout '%s' has no VERSION file.\n" "${dir}" >&2
    install_hint
    exit 1
  fi
  found="$(read_version "${dir}/VERSION")"
  [ -n "${found}" ] || die_check "VERSION in '${dir}' is empty"
  if [ "${found}" != "${expected}" ]; then
    printf "polier.sh: version mismatch: '%s' has %s, board.json expects %s.\n" "${dir}" "${found}" "${expected}" >&2
    install_hint
    exit 1
  fi
  if [ -d "${dir}/.git" ]; then
    if ! tag="$(git -C "${dir}" describe --tags --exact-match 2>/dev/null)"; then
      printf "polier.sh: '%s' is not at an exact tag; board.json expects v%s.\n" "${dir}" "${expected}" >&2
      install_hint
      exit 1
    fi
    if [ "${tag}" != "v${expected}" ]; then
      printf "polier.sh: '%s' is tagged %s, board.json expects v%s.\n" "${dir}" "${tag}" "${expected}" >&2
      install_hint
      exit 1
    fi
  else
    printf "polier.sh: warning: '%s' is not a git checkout; the exact tag v%s cannot be verified.\n" "${dir}" "${expected}" >&2
  fi
}

cmd_check() {
  local version
  version="$(board_version)"
  if [ -z "${POLIER:-}" ]; then
    printf 'polier.sh: POLIER is not set; it must point at a Polier checkout of v%s.\n' "${version}" >&2
    install_hint
    exit 1
  fi
  check_checkout "${POLIER}" "${version}"
  printf 'polier.sh: v%s at %s\n' "${version}" "${POLIER}"
}

cmd_show() {
  local version
  local checkout
  version="$(board_version)"
  if [ -n "${POLIER:-}" ]; then
    checkout="${POLIER}"
  elif [ -d "${POLIER_HOME}/${version}" ]; then
    checkout="${POLIER_HOME}/${version}"
  else
    printf 'polier.sh: no checkout resolved: POLIER is unset and %s does not exist.\n' "${POLIER_HOME}/${version}" >&2
    install_hint
    exit 1
  fi
  check_checkout "${checkout}" "${version}"
  printf 'checkout: %s\nversion: %s\n' "${checkout}" "${version}"
}

cmd_install() {
  local version
  local target
  version="$(board_version)"
  target="${1:-${POLIER_HOME}/${version}}"
  [ -n "${target}" ] || die_usage "target directory must not be empty"

  if [ -d "${target}" ] && [ -n "$(ls -A "${target}" 2>/dev/null)" ]; then
    if [ -f "${target}/VERSION" ] && [ "$(read_version "${target}/VERSION")" = "${version}" ]; then
      check_checkout "${target}" "${version}"
      printf '%s\n' "${target}"
      return 0
    fi
    die_check "target '${target}' exists and is not a v${version} checkout; remove it or pass another directory"
  fi

  mkdir -p "$(dirname -- "${target}")"
  printf 'polier.sh: cloning %s (tag v%s) into %s\n' "${POLIER_REMOTE}" "${version}" "${target}" >&2
  if ! GIT_TERMINAL_PROMPT=0 git -c advice.detachedHead=false clone --depth 1 --branch "v${version}" "${POLIER_REMOTE}" "${target}" >&2; then
    die_check "git clone of ${POLIER_REMOTE} tag v${version} failed"
  fi
  check_checkout "${target}" "${version}"
  printf '%s\n' "${target}"
}

main() {
  require_board
  [ "$#" -gt 0 ] || die_usage "missing command"
  case "$1" in
    --check)
      [ "$#" -eq 1 ] || die_usage "--check takes no arguments"
      cmd_check
      ;;
    --install)
      [ "$#" -le 2 ] || die_usage "--install takes at most one directory"
      cmd_install "${2:-}"
      ;;
    --show)
      [ "$#" -eq 1 ] || die_usage "--show takes no arguments"
      cmd_show
      ;;
    --help | -h)
      usage
      ;;
    *)
      die_usage "unknown command '$1'"
      ;;
  esac
}

main "$@"
