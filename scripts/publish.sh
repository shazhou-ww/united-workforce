#!/usr/bin/env bash
# publish.sh — Bump version & publish all @uncaged/workflow-* packages
#
# Usage:
#   ./scripts/publish.sh 0.4.0    # explicit version
#   ./scripts/publish.sh patch    # 0.3.1 → 0.3.2
#   ./scripts/publish.sh minor    # 0.3.1 → 0.4.0
#
# Env (via `cfg` or export):
#   GITEA_TOKEN  — Gitea npm registry auth
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GITEA_TOKEN="${GITEA_TOKEN:?GITEA_TOKEN is required}"
GITEA_NPM_REGISTRY="https://git.shazhou.work/api/packages/uncaged/npm/"

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
VERSION=$(bump_version "$CURRENT" "${1:?Usage: publish.sh <version|patch|minor|major>}")
echo "📦 Publish: $CURRENT → $VERSION"

# ─── Topological publish order ───────────────────────────────────────────────
PUBLISH_ORDER=(
  workflow-protocol
  workflow-util
  workflow-cas
  workflow-runtime
  workflow-reactor
  workflow-register
  workflow-execute
  cli-workflow
  workflow-util-agent
  workflow-agent-cursor
  workflow-agent-hermes
  workflow-agent-llm
  workflow-template-develop
  workflow-template-solve-issue
)

# ─── Bump version ────────────────────────────────────────────────────────────
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

# ─── Replace workspace:* ─────────────────────────────────────────────────────
echo "🔗 Replacing workspace:* → $VERSION..."
for dir in packages/*/; do
  pkg="$dir/package.json"
  [[ -f "$pkg" ]] || continue
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$pkg','utf8'));
    let c = false;
    for (const k of ['dependencies','peerDependencies','devDependencies']) {
      if (!p[k]) continue;
      for (const [n, v] of Object.entries(p[k])) {
        if (n.startsWith('@uncaged/') && v === 'workspace:*') { p[k][n] = '$VERSION'; c = true; }
      }
    }
    if (c) fs.writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
  "
done

# ─── Build ───────────────────────────────────────────────────────────────────
echo "🔨 Building..."
npm run build

# ─── Publish ─────────────────────────────────────────────────────────────────
echo "🚀 Publishing..."
cat > "$REPO_ROOT/.npmrc" <<EOF
@uncaged:registry=${GITEA_NPM_REGISTRY}
//${GITEA_NPM_REGISTRY#https://}:_authToken=${GITEA_TOKEN}
EOF

FAIL=0
for pkg_dir in "${PUBLISH_ORDER[@]}"; do
  if (cd "packages/$pkg_dir" && npm publish 2>&1); then
    echo "  ✅ @uncaged/$pkg_dir@$VERSION"
  else
    echo "  ❌ @uncaged/$pkg_dir"
    FAIL=1
  fi
done

# ─── Restore workspace:* ─────────────────────────────────────────────────────
echo "🔄 Restoring workspace:*..."
for dir in packages/*/; do
  pkg="$dir/package.json"
  [[ -f "$pkg" ]] || continue
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$pkg','utf8'));
    let c = false;
    for (const k of ['dependencies','peerDependencies','devDependencies']) {
      if (!p[k]) continue;
      for (const [n, v] of Object.entries(p[k])) {
        if (n.startsWith('@uncaged/') && v === '$VERSION') { p[k][n] = 'workspace:*'; c = true; }
      }
    }
    if (c) fs.writeFileSync('$pkg', JSON.stringify(p, null, 2) + '\n');
  "
done

# ─── Commit ──────────────────────────────────────────────────────────────────
echo "📝 Committing..."
git add -A
git commit -m "chore: publish v${VERSION}

小橘 <xiaoju@shazhou.work>"
git push

[[ "$FAIL" -eq 0 ]] && echo "✅ v${VERSION} published" || echo "⚠️ v${VERSION} published with errors"
