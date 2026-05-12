#!/usr/bin/env bash
# Publish all public @uncaged/* packages to Gitea npm registry.
#
# Usage:
#   ./scripts/publish-all.sh           # Publish all packages
#   ./scripts/publish-all.sh --dry-run # Show what would be published
#
# Prerequisites:
#   - .npmrc in monorepo root with Gitea auth token
#   - bun (for packing with workspace:* resolution)
#   - npm (for publishing tarballs)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REGISTRY="https://git.shazhou.work/api/packages/shazhou/npm/"
DRY_RUN=""

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "🔍 Dry run mode — no packages will be published"
  echo
fi

# Dependency order matters: leaf packages first
PACKAGES=(
  workflow-protocol
  workflow-util
  workflow-cas
  workflow-runtime
  workflow-reactor
  workflow-register
  workflow-execute
  workflow-util-agent
  workflow-agent-cursor
  workflow-agent-hermes
  workflow-agent-llm
  workflow-template-develop
  workflow-template-solve-issue
  cli-workflow
)

ok=0
fail=0

for pkg in "${PACKAGES[@]}"; do
  dir="$MONOREPO_ROOT/packages/$pkg"
  [[ -f "$dir/package.json" ]] || { echo "⚠️  skip $pkg (no package.json)"; continue; }

  # Skip private packages
  if grep -q '"private": true' "$dir/package.json" 2>/dev/null; then
    echo "  skip    @uncaged/$pkg (private)"
    continue
  fi

  cd "$dir"

  # bun pm pack resolves workspace:* → actual versions
  tgz=$(bun pm pack 2>&1 | grep '\.tgz' | grep -v packed | head -1 | tr -d ' ')

  if [[ -z "$tgz" || ! -f "$tgz" ]]; then
    echo "❌ @uncaged/$pkg — pack failed"
    ((fail++)) || true
    continue
  fi

  if npm publish "$tgz" --registry="$REGISTRY" $DRY_RUN 2>&1 | tail -1 | grep -q '+'; then
    echo "✅ @uncaged/$pkg"
    ((ok++)) || true
  else
    # Could be "already published" — not necessarily an error
    echo "⚠️  @uncaged/$pkg (may already exist at this version)"
  fi

  rm -f "$tgz"
done

echo
echo "Published: $ok  Skipped/Failed: $fail"
