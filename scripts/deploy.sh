#!/usr/bin/env bash
# deploy.sh — Build & deploy dashboard + gateway to Cloudflare
#
# Usage:
#   ./scripts/deploy.sh              # deploy both
#   ./scripts/deploy.sh dashboard    # dashboard only
#   ./scripts/deploy.sh gateway      # gateway only
#
# Env (via `cfg` or export):
#   CLOUDFLARE_API_TOKEN  — Cloudflare API token
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
export CLOUDFLARE_API_TOKEN

TARGET="${1:-all}"

deploy_dashboard() {
  echo "🌐 Building dashboard..."
  (cd packages/workflow-dashboard && npm run build)
  echo "🚀 Deploying dashboard to Cloudflare Pages..."
  (cd packages/workflow-gateway && npx wrangler pages deploy \
    ../workflow-dashboard/dist \
    --project-name workflow-dashboard)
  echo "  ✅ Dashboard → workflow.shazhou.work"
}

deploy_gateway() {
  echo "🚀 Deploying gateway Worker..."
  (cd packages/workflow-gateway && npx wrangler deploy)
  echo "  ✅ Gateway → workflow-gateway.shazhou.workers.dev"
}

case "$TARGET" in
  dashboard) deploy_dashboard ;;
  gateway)   deploy_gateway ;;
  all)       deploy_dashboard; deploy_gateway ;;
  *)         echo "Usage: deploy.sh [dashboard|gateway|all]"; exit 1 ;;
esac

echo "✅ Deploy complete"
