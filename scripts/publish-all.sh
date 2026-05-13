#!/usr/bin/env bash
# Publish all public @uncaged/* packages to Gitea npm registry.
#
# PITFALL: After bumping versions in package.json, bun pm pack still reads the
# old bun.lock and resolves workspace:* to the previous (stale) versions.
# This script deletes bun.lock and runs bun install before packing to force
# correct resolution of workspace:* dependencies.
#
# Usage:
#   ./scripts/publish-all.sh           # Publish all packages
#   ./scripts/publish-all.sh --dry-run # Show what would be published
#
# Package order is auto-resolved via topological sort of workspace:* dependencies.
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

# Topological sort: read all package.json files, build dependency graph, emit leaf-first order
ORDERED=$(python3 -c "
import json, os, sys
from pathlib import Path

pkgs_dir = Path('$MONOREPO_ROOT/packages')
# name -> dir_name, and dependency edges
name_to_dir = {}
deps_graph = {}  # name -> set of @uncaged/* dependency names

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
            if dep.startswith('@uncaged/') and dep in name_to_dir or ver == 'workspace:*':
                local_deps.add(dep)
    deps_graph[name] = local_deps

# Kahn's algorithm
in_degree = {n: 0 for n in deps_graph}
for n, ds in deps_graph.items():
    for d in ds:
        if d in in_degree:
            in_degree[d] = in_degree.get(d, 0)  # ensure exists

# Recount
in_degree = {n: 0 for n in deps_graph}
for n, ds in deps_graph.items():
    for d in ds:
        if d in in_degree:
            in_degree[d] += 1

# Wait, direction is wrong. If A depends on B, B must be published first.
# So edge is: A -> B means B must come before A.
# in_degree[A] = number of deps A has (that are in our set)
in_degree = {n: 0 for n in deps_graph}
for n, ds in deps_graph.items():
    for d in ds:
        if d in in_degree:
            pass  # d is a dependency of n
    in_degree[n] = len([d for d in ds if d in deps_graph])

queue = [n for n, deg in in_degree.items() if deg == 0]
queue.sort()  # stable order
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

# Regenerate lockfile so bun pm pack resolves workspace:* to freshly-bumped versions
cd "$MONOREPO_ROOT"
rm -f bun.lock
bun install

ok=0
fail=0

while IFS= read -r pkg; do
  dir="$MONOREPO_ROOT/packages/$pkg"
  name=$(grep -m1 '"name"' "$dir/package.json" | sed 's/.*: *"\(.*\)".*/\1/')

  cd "$dir"

  # bun pm pack resolves workspace:* → actual versions
  tgz=$(bun pm pack 2>&1 | grep '\.tgz' | grep -v packed | head -1 | tr -d ' ')

  if [[ -z "$tgz" || ! -f "$tgz" ]]; then
    echo "❌ $name — pack failed"
    ((fail++)) || true
    continue
  fi

  if npm publish "$tgz" --registry="$REGISTRY" $DRY_RUN 2>&1 | tail -1 | grep -q '+'; then
    echo "✅ $name"
    ((ok++)) || true
  else
    echo "⚠️  $name (may already exist at this version)"
  fi

  rm -f "$tgz"
done <<< "$ORDERED"

echo
echo "Published: $ok  Skipped/Failed: $fail"
