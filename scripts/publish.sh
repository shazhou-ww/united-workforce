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

# ─── Auto-discover publishable packages (topological order) ──────────────────
# Finds all non-private packages and sorts by internal dependency count (fewest first)
mapfile -t PUBLISH_ORDER < <(node -e "
  const fs = require('fs');
  const path = require('path');
  const pkgsDir = path.join('$REPO_ROOT', 'packages');
  const dirs = fs.readdirSync(pkgsDir).filter(d =>
    fs.existsSync(path.join(pkgsDir, d, 'package.json'))
  );
  // Collect non-private packages
  const pkgs = new Map();
  for (const d of dirs) {
    const p = JSON.parse(fs.readFileSync(path.join(pkgsDir, d, 'package.json'), 'utf8'));
    if (p.private) continue;
    const deps = new Set();
    for (const k of ['dependencies','peerDependencies','devDependencies']) {
      if (!p[k]) continue;
      for (const n of Object.keys(p[k])) {
        if (n.startsWith('@uncaged/')) deps.add(n.replace('@uncaged/',''));
      }
    }
    pkgs.set(d, deps);
  }
  // Topological sort (Kahn's) — publish dependencies before dependents
  const inDeg = new Map([...pkgs.keys()].map(k => [k, 0]));
  for (const [pkg, deps] of pkgs) {
    for (const dep of deps) {
      if (pkgs.has(dep)) inDeg.set(pkg, (inDeg.get(pkg) || 0) + 1);
    }
  }
  const queue = [...inDeg.entries()].filter(([,d]) => d === 0).map(([k]) => k).sort();
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const [pkg, deps] of pkgs) {
      if (deps.has(n)) {
        inDeg.set(pkg, inDeg.get(pkg) - 1);
        if (inDeg.get(pkg) === 0) queue.push(pkg);
      }
    }
  }
  // Append any remaining (circular or isolated) — should not happen
  for (const k of pkgs.keys()) { if (!order.includes(k)) order.push(k); }
  order.forEach(o => console.log(o));
")
echo "📋 Discovered ${#PUBLISH_ORDER[@]} packages: ${PUBLISH_ORDER[*]}"

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

# ─── Self-test ────────────────────────────────────────────────────────────────
echo "🧪 Running tests..."
if ! npm test; then
  echo "❌ Tests failed — aborting publish"
  exit 1
fi

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

if [[ "$FAIL" -ne 0 ]]; then
  echo "⚠️ v${VERSION} published with errors"
  exit 1
fi

# ─── Post-publish smoke test ─────────────────────────────────────────────────
echo "🔍 Smoke test: installing & verifying published packages..."
SMOKE_DIR=$(mktemp -d)
trap "rm -rf $SMOKE_DIR" EXIT

cat > "$SMOKE_DIR/.npmrc" <<EOF
@uncaged:registry=${GITEA_NPM_REGISTRY}
//${GITEA_NPM_REGISTRY#https://}:_authToken=${GITEA_TOKEN}
EOF

# Install all published packages in a clean temp dir
PKGS_TO_INSTALL=""
for pkg_dir in "${PUBLISH_ORDER[@]}"; do
  PKGS_TO_INSTALL="$PKGS_TO_INSTALL @uncaged/${pkg_dir}@${VERSION}"
done

(cd "$SMOKE_DIR" && npm init -y --silent >/dev/null 2>&1 && npm install $PKGS_TO_INSTALL 2>&1) || {
  echo "❌ Smoke test failed: could not install packages"
  exit 1
}

# Try importing each package
for pkg_dir in "${PUBLISH_ORDER[@]}"; do
  if ! (cd "$SMOKE_DIR" && node -e "require('@uncaged/${pkg_dir}')" 2>&1); then
    echo "❌ Smoke test failed: require('@uncaged/${pkg_dir}') threw"
    exit 1
  fi
  echo "  ✅ @uncaged/${pkg_dir} — importable"
done

echo "✅ v${VERSION} published & verified"
