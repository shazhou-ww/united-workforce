#!/usr/bin/env bash
# Link all @uncaged/* packages from the workflow monorepo for local development.
#
# Usage:
#   ./scripts/link-all.sh              # Register all packages (run from monorepo root)
#   ./scripts/link-all.sh --consume    # Link all packages into CWD's project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "${1:-}" == "--consume" ]]; then
  # Consumer mode: bun link each @uncaged/* package into the current project
  for dir in "$MONOREPO_ROOT"/packages/*/; do
    [[ -f "$dir/package.json" ]] || continue
    name=$(grep -m1 '"name"' "$dir/package.json" | sed 's/.*: *"\(.*\)".*/\1/')
    echo "linking $name"
    bun link "$name" 2>&1 | grep -v "^$"
  done
  echo "✅ All @uncaged/* packages linked into $(pwd)"
else
  # Register mode: register all packages from monorepo
  for dir in "$MONOREPO_ROOT"/packages/*/; do
    [[ -f "$dir/package.json" ]] || continue
    name=$(grep -m1 '"name"' "$dir/package.json" | sed 's/.*: *"\(.*\)".*/\1/')
    echo "registering $name"
    (cd "$dir" && bun link 2>&1 | grep -v "^$")
  done
  echo "✅ All @uncaged/* packages registered"
  echo ""
  echo "To consume in another project, run:"
  echo "  $0 --consume"
  echo "  (from the target project directory)"
fi
