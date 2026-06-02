#!/usr/bin/env bash
# Check development environment prerequisites for shazhou/united-workforce.
# Non-interactive — prints actionable fix instructions on failure.
# Exit 0 = all good, exit 1 = missing dependencies.
set -euo pipefail

errors=0

check() {
  local name="$1" check_cmd="$2" fix_msg="$3"
  if eval "$check_cmd" >/dev/null 2>&1; then
    echo "✅ $name"
  else
    echo "❌ $name"
    echo "   Fix: $fix_msg"
    errors=$((errors + 1))
  fi
}

check_version() {
  local name="$1" cmd="$2" fix_msg="$3"
  local version
  if version=$(eval "$cmd" 2>/dev/null | head -1); then
    echo "✅ $name — $version"
  else
    echo "❌ $name"
    echo "   Fix: $fix_msg"
    errors=$((errors + 1))
  fi
}

echo "=== Runtime ==="
check_version "bun" "bun --version" \
  "curl -fsSL https://bun.sh/install | bash"

check_version "node" "node --version" \
  "Install Node.js 20+: https://nodejs.org/"

check_version "python3" "python3 --version" \
  "Install Python 3.11+: https://www.python.org/ or use uv: curl -LsSf https://astral.sh/uv/install.sh | sh && uv python install 3.11"

echo ""
echo "=== Tools ==="
check_version "hermes" "hermes --version" \
  "See https://github.com/hermes-ai/hermes-agent for installation. Typical: pip install hermes-agent (or uv pip install -e . for dev)"

check_version "claude" "claude --version" \
  "npm install -g @anthropic-ai/claude-code"

echo ""
echo "=== Workflow ==="

# Check repo location
REPO_DIR="${WORKFLOW_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
check "repo at ~/repos/workflow or WORKFLOW_REPO set" \
  "[ -f '$REPO_DIR/packages/cli/src/cli.ts' ]" \
  "Clone the repo: git clone https://git.shazhou.work/shazhou/united-workforce ~/repos/workflow"

# Check bun install
check "node_modules installed" \
  "[ -d '$REPO_DIR/node_modules' ]" \
  "cd $REPO_DIR && bun install"

# Check build
check "packages built (dist/)" \
  "[ -f '$REPO_DIR/packages/cli/dist/cli.js' ]" \
  "cd $REPO_DIR && bun run build"

# Check uwf is runnable
check_version "uwf" "bun $REPO_DIR/packages/cli/src/cli.ts --version" \
  "cd $REPO_DIR && bun install && bun run build"

# Check uwf symlink
check "uwf in PATH" \
  "command -v uwf" \
  "sudo ln -sf $REPO_DIR/packages/cli/dist/cli.js /usr/bin/uwf && sudo chmod +x /usr/bin/uwf"

# Check uwf-hermes
check "uwf-hermes in PATH" \
  "command -v uwf-hermes" \
  "bun link in packages/agent-hermes, or: echo '#!/usr/bin/env bun' > ~/.local/bin/uwf-hermes && echo 'import \"$REPO_DIR/packages/agent-hermes/src/cli.ts\"' >> ~/.local/bin/uwf-hermes && chmod +x ~/.local/bin/uwf-hermes"

# Check uwf-claude-code
check "uwf-claude-code in PATH" \
  "command -v uwf-claude-code" \
  "Create wrapper: echo '#!/bin/bash\nexec bun run $REPO_DIR/packages/agent-claude-code/src/cli.ts \"\$@\"' > ~/.local/bin/uwf-claude-code && chmod +x ~/.local/bin/uwf-claude-code"

echo ""
echo "=== Config ==="

# Check workflow config exists
CONFIG_DIR="${UWF_STORAGE_ROOT:-$HOME/.shazhou/united-workforce}"
check "config.yaml exists" \
  "[ -f '$CONFIG_DIR/config.yaml' ]" \
  "Run: uwf setup"

# Check config has apiKey (not apiKeyEnv)
if [ -f "$CONFIG_DIR/config.yaml" ]; then
  check "config uses apiKey (not legacy apiKeyEnv)" \
    "grep -q 'apiKey:' '$CONFIG_DIR/config.yaml' && ! grep -q 'apiKeyEnv:' '$CONFIG_DIR/config.yaml'" \
    "Run: uwf setup (re-configure to write apiKey directly)"
fi

echo ""
echo "=== Docker (optional, for E2E tests) ==="
check_version "docker" "docker --version" \
  "sudo apt install -y docker.io && sudo usermod -aG docker \$USER"

check "docker daemon running" \
  "docker info" \
  "sudo systemctl start docker"

echo ""
if [ "$errors" -gt 0 ]; then
  echo "⚠️  $errors issue(s) found. Fix them and re-run this script."
  exit 1
else
  echo "🎉 All checks passed!"
  exit 0
fi
