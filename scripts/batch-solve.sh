#!/usr/bin/env bash
# batch-solve.sh — solve multiple Gitea issues via solve-issue workflow
#
# Usage:
#   ./scripts/batch-solve.sh [--agent CMD] [--repo OWNER/REPO] [--count N] ISSUE_NUM...
#
# Examples:
#   ./scripts/batch-solve.sh 448 449
#   ./scripts/batch-solve.sh --agent "bun run $(pwd)/packages/agent-claude-code/src/cli.ts" 448 449
#   ./scripts/batch-solve.sh --repo uncaged/workflow --count 15 448 449

set -euo pipefail

AGENT=""
REPO="uncaged/workflow"
COUNT=10
ISSUES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)  AGENT="$2"; shift 2 ;;
    --repo)   REPO="$2"; shift 2 ;;
    --count)  COUNT="$2"; shift 2 ;;
    *)        ISSUES+=("$1"); shift ;;
  esac
done

if [[ ${#ISSUES[@]} -eq 0 ]]; then
  echo "Usage: $0 [--agent CMD] [--repo OWNER/REPO] [--count N] ISSUE_NUM..." >&2
  exit 1
fi

AGENT_FLAG=""
if [[ -n "$AGENT" ]]; then
  AGENT_FLAG="--agent $AGENT"
fi

TOTAL=${#ISSUES[@]}
PASSED=0
FAILED=0
RESULTS=()

echo "━━━ Batch solve: ${TOTAL} issues ━━━"
echo ""

for i in "${!ISSUES[@]}"; do
  ISSUE="${ISSUES[$i]}"
  NUM=$((i + 1))
  echo "┌─── [$NUM/$TOTAL] Issue #${ISSUE} ───"

  # Read issue title
  TITLE=$(tea issues "$ISSUE" -r "$REPO" 2>/dev/null | head -1 | sed 's/^# #[0-9]* //' | sed 's/ (.*//' || echo "unknown")
  echo "│ Title: $TITLE"

  # Start thread
  PROMPT="Fix issue #${ISSUE} in ${REPO}. Read the issue first with 'tea issues ${ISSUE} -r ${REPO}' for full spec."
  THREAD_JSON=$(uwf thread start solve-issue -p "$PROMPT" 2>&1)
  THREAD_ID=$(echo "$THREAD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['thread'])")
  echo "│ Thread: $THREAD_ID"

  # Run steps
  echo "│ Running (max $COUNT steps)..."
  # shellcheck disable=SC2086
  if STEP_OUTPUT=$(uwf thread step "$THREAD_ID" $AGENT_FLAG -c "$COUNT" 2>&1); then
    # Check if done
    LAST_DONE=$(echo "$STEP_OUTPUT" | python3 -c "import json,sys; lines=sys.stdin.read().strip(); data=json.loads(lines); print(data[-1].get('done', False))")
    if [[ "$LAST_DONE" == "True" ]]; then
      echo "│ ✅ Done!"
      PASSED=$((PASSED + 1))
      RESULTS+=("✅ #${ISSUE} — ${TITLE}")
    else
      echo "│ ⚠️  Ran out of steps (not done)"
      FAILED=$((FAILED + 1))
      RESULTS+=("⚠️  #${ISSUE} — ${TITLE} (incomplete)")
    fi
  else
    echo "│ ❌ Failed"
    FAILED=$((FAILED + 1))
    RESULTS+=("❌ #${ISSUE} — ${TITLE} (error)")
  fi

  echo "└───"
  echo ""
done

echo "━━━ Results: ${PASSED}/${TOTAL} passed, ${FAILED} failed ━━━"
for R in "${RESULTS[@]}"; do
  echo "  $R"
done
