#!/usr/bin/env bash
# Link / unlink all @uncaged/* packages from the workflow monorepo.
#
# Usage:
#   ./scripts/link-all.sh              # Register all packages (run from monorepo root)
#   ./scripts/link-all.sh --consume    # Link all packages into CWD's project
#   ./scripts/link-all.sh --unlink     # Unregister all packages and restore CWD's deps

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Iterate package dirs, calling callback(dir, name) for each
each_pkg() {
  local cb="$1"
  for dir in "$MONOREPO_ROOT"/packages/*/; do
    [[ -f "$dir/package.json" ]] || continue
    local name
    name=$(grep -m1 '"name"' "$dir/package.json" | sed 's/.*: *"\(.*\)".*/\1/')
    "$cb" "$dir" "$name"
  done
}

do_register() { printf "  register  %s\n" "$2"; (cd "$1" && bun link 2>&1) > /dev/null; }
do_consume()  { printf "  link      %s\n" "$2"; (bun link "$2" 2>&1) > /dev/null; }
do_unlink()   { printf "  unlink    %s\n" "$2"; (cd "$1" && bun unlink 2>&1) > /dev/null || true; }

case "${1:-}" in
  --consume)
    each_pkg do_consume
    echo "✅ All @uncaged/* packages linked into $(pwd)"
    echo "   To restore: $0 --unlink"
    ;;
  --unlink)
    each_pkg do_unlink
    if [[ -f "package.json" ]]; then
      echo "  reinstalling deps..."
      bun install 2>&1 > /dev/null || true
    fi
    echo "✅ All @uncaged/* packages unlinked, deps restored"
    ;;
  *)
    each_pkg do_register
    echo "✅ All @uncaged/* packages registered"
    echo "   cd <project> && $0 --consume"
    ;;
esac
