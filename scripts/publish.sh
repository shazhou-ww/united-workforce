#!/usr/bin/env bash
# publish.sh — Bump version, build, test & publish all @uncaged/workflow-* packages
#
# Usage:
#   ./scripts/publish.sh patch        # 0.3.1 → 0.3.2
#   ./scripts/publish.sh minor        # 0.3.1 → 0.4.0
#   ./scripts/publish.sh major        # 0.3.1 → 1.0.0
#   ./scripts/publish.sh 0.5.0        # explicit version
#   ./scripts/publish.sh patch --dry-run  # preview without publishing
#
# Env (via `cfg` or export):
#   GITEA_TOKEN  — Gitea npm registry auth (used by .npmrc)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GITEA_TOKEN="${GITEA_TOKEN:?GITEA_TOKEN is required}"
REGISTRY="https://git.shazhou.work/api/packages/uncaged/npm/"

DRY_RUN=""
VERSION_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    *)         VERSION_ARG="$arg" ;;
  esac
done
[[ -z "$VERSION_ARG" ]] && { echo "Usage: publish.sh <version|patch|minor|major> [--dry-run]"; exit 1; }

# ─── Version ─────────────────────────────────────────────────────────────────
current_version() {
  node -e "console.log(require('./packages/workflow-protocol/package.json').version)"
}

bump_version() {
  local cur="$1" kind="$2"
  IFS='.' read -r major minor patch <<< "$cur"
  case "$kind" in
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    major) echo "$((major + 1)).0.0" ;;
    *)     echo "$kind" ;;
  esac
}

CURRENT=$(current_version)
VERSION=$(bump_version "$CURRENT" "$VERSION_ARG")
echo "📦 Publish: $CURRENT → $VERSION"
[[ -n "$DRY_RUN" ]] && echo "🔍 Dry run mode — no packages will be published"

# ─── Bump version in all public packages ─────────────────────────────────────
echo "🔢 Bumping versions..."
for dir in packages/*/; do
  pkg="$dir/package.json"
  [[ -f "$pkg" ]] || continue
  is_private=$(node -e "console.log(require('./$pkg').private || false)")
  [[ "$is_private" == "true" ]] && continue
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$pkg','utf8'));
    p.version = '$VERSION';
    fs.writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
  "
done

# ─── Build ───────────────────────────────────────────────────────────────────
echo "🔨 Building..."
npm run build

# ─── Self-test ───────────────────────────────────────────────────────────────
echo "🧪 Running tests..."
if ! bun test; then
  echo "❌ Tests failed — aborting publish"
  exit 1
fi

# ─── Topological sort of public packages ─────────────────────────────────────
echo "📐 Resolving publish order..."
ORDERED=$(python3 -c "
import json, os
from pathlib import Path

pkgs_dir = Path('$REPO_ROOT/packages')
name_to_dir = {}
deps_graph = {}

for d in sorted(pkgs_dir.iterdir()):
    pj = d / 'package.json'
    if not pj.exists():
        continue
    data = json.loads(pj.read_text())
    name = data.get('name', '')
    if not name.startswith('@uncaged/'):
        continue
    if data.get('private'):
        continue
    name_to_dir[name] = d.name
    local_deps = set()
    for section in ('dependencies', 'devDependencies', 'peerDependencies'):
        for dep, ver in data.get(section, {}).items():
            if dep.startswith('@uncaged/') and ver == 'workspace:*':
                local_deps.add(dep)
    deps_graph[name] = local_deps

# Kahn's algorithm — deps-first order
in_degree = {n: len([d for d in ds if d in deps_graph]) for n, ds in deps_graph.items()}
queue = sorted(n for n, deg in in_degree.items() if deg == 0)
result = []
while queue:
    node = queue.pop(0)
    result.append(node)
    for n, ds in deps_graph.items():
        if node in ds:
            in_degree[n] -= 1
            if in_degree[n] == 0:
                queue.append(n)
    queue.sort()

for name in result:
    print(name_to_dir[name])
")

# ─── Regenerate lockfile for correct workspace:* resolution ──────────────────
rm -f bun.lock
bun install

# ─── Publish via bun pm pack + npm publish ───────────────────────────────────
echo "🚀 Publishing..."
ok=0
fail=0

while IFS= read -r pkg; do
  dir="$REPO_ROOT/packages/$pkg"
  name=$(node -e "console.log(require('./$dir/package.json').name)")

  cd "$dir"

  # bun pm pack resolves workspace:* → actual versions in the tarball
  tgz=$(bun pm pack 2>&1 | grep '\.tgz' | grep -v packed | head -1 | tr -d ' ')

  if [[ -z "$tgz" || ! -f "$tgz" ]]; then
    echo "❌ $name — pack failed"
    ((fail++)) || true
    continue
  fi

  if npm publish "$tgz" --registry="$REGISTRY" $DRY_RUN 2>&1 | tail -1 | grep -q '+'; then
    echo "✅ $name@$VERSION"
    ((ok++)) || true
  else
    echo "⚠️  $name (may already exist at this version)"
  fi

  rm -f "$tgz"
done <<< "$ORDERED"

cd "$REPO_ROOT"

echo
echo "Published: $ok  Skipped/Failed: $fail"

# ─── Restore workspace:* (bun pack doesn't modify source, but version bump did) ─
echo "🔄 Restoring lockfile..."
rm -f bun.lock
bun install

# ─── Commit ──────────────────────────────────────────────────────────────────
if [[ -z "$DRY_RUN" ]]; then
  echo "📝 Committing..."
  git add -A
  git commit -m "chore: publish v${VERSION}"
  git push
fi

echo "✅ v${VERSION} published"
