#!/usr/bin/env bash
# publish.sh — Bump version, build, test, topologically publish @uncaged/* to Gitea npm
#
# Usage:
#   ./scripts/publish.sh 0.4.0             # explicit version
#   ./scripts/publish.sh patch             # 0.3.1 → 0.3.2
#   ./scripts/publish.sh minor             # 0.3.1 → 0.4.0
#   ./scripts/publish.sh major             # 0.3.1 → 1.0.0
#   ./scripts/publish.sh --dry-run patch   # dry-run bun publish only (no git commit/push)
#
# Env (via `cfg` or export):
#   GITEA_TOKEN — Gitea npm registry auth (see root .npmrc)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GITEA_TOKEN="${GITEA_TOKEN:?GITEA_TOKEN is required}"

REGISTRY="https://git.shazhou.work/api/packages/uncaged/npm/"
DRY_RUN=""

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  shift
  echo "🔍 Dry run — bun publish will not upload; git commit/push skipped"
  echo
fi

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
VERSION=$(bump_version "$CURRENT" "${1:?Usage: publish.sh [--dry-run] <version|patch|minor|major>}")
echo "📦 Publish: $CURRENT → $VERSION"

# ─── Bump version ─────────────────────────────────────────────────────────────
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

# ─── Topological publish order (workspace:* deps first) ───────────────────────
ORDERED=$(python3 -c "
import json, sys
from pathlib import Path

pkgs_dir = Path('$REPO_ROOT/packages')
name_to_dir = {}
for d in sorted(pkgs_dir.iterdir()):
    pj = d / 'package.json'
    if not pj.exists():
        continue
    data = json.loads(pj.read_text())
    name = data.get('name', '')
    if not name.startswith('@uncaged/') or data.get('private'):
        continue
    name_to_dir[name] = d.name

deps_graph = {}
for name, dirname in name_to_dir.items():
    pj = pkgs_dir / dirname / 'package.json'
    data = json.loads(pj.read_text())
    local_deps = set()
    for section in ('dependencies', 'devDependencies', 'peerDependencies'):
        for dep, ver in data.get(section, {}).items():
            if dep.startswith('@uncaged/') and dep in name_to_dir and ver == 'workspace:*':
                local_deps.add(dep)
    deps_graph[name] = local_deps

in_degree = {n: 0 for n in deps_graph}
for n, ds in deps_graph.items():
    in_degree[n] = len(ds)

queue = sorted([n for n, deg in in_degree.items() if deg == 0])
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

if len(result) != len(deps_graph):
    missing = set(deps_graph) - set(result)
    sys.stderr.write('publish: cyclic @uncaged/ workspace:* dependencies among: ' + ', '.join(sorted(missing)) + '\n')
    sys.exit(1)

for name in result:
    print(name_to_dir[name])
")

# ─── Build ────────────────────────────────────────────────────────────────────
echo "🔨 Building..."
bun run build

# ─── Self-test ────────────────────────────────────────────────────────────────
echo "🧪 Running tests..."
if ! bun test; then
  echo "❌ Tests failed — aborting publish"
  exit 1
fi

# ─── Publish (bun resolves workspace:* for publish) ──────────────────────────
echo "🚀 Publishing to $REGISTRY ..."
ok=0
fail=0

while IFS= read -r pkg; do
  [[ -n "$pkg" ]] || continue
  dir="$REPO_ROOT/packages/$pkg"
  name=$(node -e "console.log(require('$dir/package.json').name)")

  if ( cd "$dir" && bun publish --registry="$REGISTRY" ${DRY_RUN:+"$DRY_RUN"} ); then
    echo "✅ $name"
    ok=$((ok + 1))
  else
    echo "⚠️  $name (publish failed or version may already exist)"
    fail=$((fail + 1))
  fi

done <<< "$ORDERED"

echo
echo "Published: $ok  Skipped/Failed: $fail"

# ─── Commit ───────────────────────────────────────────────────────────────────
if [[ -n "$DRY_RUN" ]]; then
  echo "⏭️  Skipping git commit/push (dry run). Revert bumps with: git checkout -- packages/*/package.json"
  exit 0
fi

echo "📝 Committing..."
git add -A
git commit -m "chore: publish v${VERSION}

小橘 <xiaoju@shazhou.work>"
git push

echo "✅ v${VERSION} published"
