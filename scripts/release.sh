#!/usr/bin/env bash
# release.sh — Publish all @uncaged/workflow-* packages + deploy dashboard
#
# Usage:
#   ./scripts/release.sh <version>      # e.g. ./scripts/release.sh 0.4.0
#   ./scripts/release.sh patch          # auto-bump patch (0.3.1 → 0.3.2)
#   ./scripts/release.sh minor          # auto-bump minor (0.3.1 → 0.4.0)
#
# Required env (via `cfg` or export):
#   GITEA_TOKEN            — Gitea npm registry auth
#   CLOUDFLARE_API_TOKEN   — Cloudflare Pages deploy
#
# What it does:
#   1. Bump version in all non-private package.json
#   2. Replace workspace:* with concrete version for publishing
#   3. npm publish in dependency order to Gitea registry
#   4. Restore workspace:* for local dev
#   5. Build & deploy dashboard to Cloudflare Pages
#   6. Git commit & push
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ─── Env check ───────────────────────────────────────────────────────────────
GITEA_TOKEN="${GITEA_TOKEN:?GITEA_TOKEN is required}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

GITEA_NPM_REGISTRY="https://git.shazhou.work/api/packages/uncaged/npm/"

# ─── Version resolution ─────────────────────────────────────────────────────
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
    *)     echo "$kind" ;;  # explicit version
  esac
}

CURRENT=$(current_version)
VERSION_ARG="${1:?Usage: release.sh <version|patch|minor|major>}"
VERSION=$(bump_version "$CURRENT" "$VERSION_ARG")

echo "📦 Release: $CURRENT → $VERSION"

# ─── Publish order (topological) ─────────────────────────────────────────────
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

# ─── Step 1: Bump version ────────────────────────────────────────────────────
echo "🔢 Bumping versions to $VERSION..."
for dir in packages/*/; do
  pkg="$dir/package.json"
  [[ -f "$pkg" ]] || continue
  is_private=$(node -e "console.log(require('./$pkg').private || false)")
  [[ "$is_private" == "true" ]] && continue
  # Replace version
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
    pkg.version = '$VERSION';
    fs.writeFileSync('$pkg', JSON.stringify(pkg, null, 2) + '\n');
  "
done

# ─── Step 2: Replace workspace:* ─────────────────────────────────────────────
echo "🔗 Replacing workspace:* with $VERSION..."
for dir in packages/*/; do
  pkg="$dir/package.json"
  [[ -f "$pkg" ]] || continue
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
    let changed = false;
    for (const key of ['dependencies', 'peerDependencies', 'devDependencies']) {
      const deps = pkg[key];
      if (!deps) continue;
      for (const [name, ver] of Object.entries(deps)) {
        if (name.startsWith('@uncaged/') && ver === 'workspace:*') {
          deps[name] = '$VERSION';
          changed = true;
        }
      }
    }
    if (changed) fs.writeFileSync('$pkg', JSON.stringify(pkg, null, 2) + '\n');
  "
done

# ─── Step 3: Build ───────────────────────────────────────────────────────────
echo "🔨 Building..."
npm run build

# ─── Step 4: Publish ─────────────────────────────────────────────────────────
echo "🚀 Publishing to Gitea npm registry..."

# Write temporary .npmrc for publish auth
NPMRC="$REPO_ROOT/.npmrc"
cat > "$NPMRC" <<EOF
@uncaged:registry=${GITEA_NPM_REGISTRY}
//${GITEA_NPM_REGISTRY#https://}:_authToken=${GITEA_TOKEN}
EOF

FAIL=0
for pkg_dir in "${PUBLISH_ORDER[@]}"; do
  pkg_path="packages/$pkg_dir"
  [[ -d "$pkg_path" ]] || { echo "⚠️  $pkg_dir not found, skipping"; continue; }
  if (cd "$pkg_path" && npm publish 2>&1); then
    echo "  ✅ @uncaged/$pkg_dir@$VERSION"
  else
    echo "  ❌ @uncaged/$pkg_dir failed"
    FAIL=1
  fi
done

# ─── Step 5: Restore workspace:* ─────────────────────────────────────────────
echo "🔄 Restoring workspace:* for local dev..."
for dir in packages/*/; do
  pkg="$dir/package.json"
  [[ -f "$pkg" ]] || continue
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
    let changed = false;
    for (const key of ['dependencies', 'peerDependencies', 'devDependencies']) {
      const deps = pkg[key];
      if (!deps) continue;
      for (const [name, ver] of Object.entries(deps)) {
        if (name.startsWith('@uncaged/') && ver === '$VERSION') {
          deps[name] = 'workspace:*';
          changed = true;
        }
      }
    }
    if (changed) fs.writeFileSync('$pkg', JSON.stringify(pkg, null, 2) + '\n');
  "
done

# ─── Step 6: Deploy dashboard ────────────────────────────────────────────────
echo "🌐 Building & deploying dashboard..."
DASHBOARD_DIR="packages/workflow-dashboard"
if [[ -d "$DASHBOARD_DIR" ]]; then
  (cd "$DASHBOARD_DIR" && npm run build)
  # wrangler is only available via npx in the gateway package (has it as devDep)
  (cd packages/workflow-gateway && npx wrangler pages deploy \
    "../workflow-dashboard/dist" \
    --project-name workflow-dashboard 2>&1) && \
    echo "  ✅ Dashboard deployed" || \
    echo "  ⚠️  Dashboard deploy failed (non-fatal)"
fi

# ─── Step 7: Git commit & push ───────────────────────────────────────────────
echo "📝 Committing..."
git add -A
git commit -m "chore: release v${VERSION}

Published ${#PUBLISH_ORDER[@]} packages to Gitea npm registry.
Dashboard deployed to Cloudflare Pages.

小橘 <xiaoju@shazhou.work>"
git push

# ─── Done ────────────────────────────────────────────────────────────────────
if [[ "$FAIL" -eq 0 ]]; then
  echo ""
  echo "✅ Released v${VERSION} — ${#PUBLISH_ORDER[@]} packages published"
else
  echo ""
  echo "⚠️  Released v${VERSION} with some failures — check output above"
fi
