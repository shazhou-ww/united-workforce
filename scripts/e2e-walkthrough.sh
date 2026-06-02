#!/usr/bin/env bash
# E2E walkthrough for uncaged/workflow.
# Runs inside Docker with isolated UNCAGED_WORKFLOW_STORAGE_ROOT.
# Exercises: setup → workflow add → thread start/exec → cancel/fork → read/inspect.
#
# Usage:
#   sudo -E scripts/e2e-walkthrough.sh [--agent <agent>] [--provider <provider>] [--model <model>] [--api-key <key>]
#
# Requires: Docker running, $HOME mount approach (see scripts/check-dev-env.sh).
# Produces: JSON report on stdout, logs in $E2E_DIR.
#
# IMPORTANT: Must run with `sudo -E` to preserve $HOME (Docker needs root).
#
# Known Issues (WIP):
#   1. `echo '$OUT' | jq` breaks when $OUT contains single quotes (e.g. workflow show
#      output with YAML). Fix: use heredoc or pipe variable directly.
#   2. Config may still have old `apiKeyEnv` field — thread exec will fail with
#      "no API key". Fix: re-run `uwf setup` or manually set `apiKey` in config.
#   3. Bootstrap installs jq via apt-get which adds ~30s startup time.
#      Consider baking a custom image or using node's JSON.parse instead.
#   4. `bun install` in container may modify host's lockfile/node_modules.
#      Consider `--frozen-lockfile` or read-only mount for non-essential paths.

set -euo pipefail

# --- Args ---
AGENT="uwf-builtin"
PROVIDER=""
MODEL=""
API_KEY=""
KEEP_CONTAINER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)     AGENT="$2";    shift 2 ;;
    --provider)  PROVIDER="$2"; shift 2 ;;
    --model)     MODEL="$2";    shift 2 ;;
    --api-key)   API_KEY="$2";  shift 2 ;;
    --keep)      KEEP_CONTAINER=true; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# --- Resolve paths ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
E2E_DIR=$(mktemp -d /tmp/uwf-e2e-XXXXXX)
CONTAINER_NAME="uwf-e2e-$(date +%s)"

echo "=== uwf E2E walkthrough ===" >&2
echo "Agent:     $AGENT" >&2
echo "Provider:  ${PROVIDER:-"(from config)"}" >&2
echo "Model:     ${MODEL:-"(from config)"}" >&2
echo "E2E dir:   $E2E_DIR" >&2
echo "Container: $CONTAINER_NAME" >&2
echo "" >&2

# --- Cleanup ---
cleanup() {
  if [ "$KEEP_CONTAINER" = false ]; then
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- Build inner script ---
# This runs INSIDE the container with an isolated storage root.
cat > "$E2E_DIR/run.sh" << 'INNER_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

# Isolated storage — never touches host's ~/.uncaged/workflow
export UNCAGED_WORKFLOW_STORAGE_ROOT="/tmp/uwf-e2e-storage"
mkdir -p "$UNCAGED_WORKFLOW_STORAGE_ROOT"

REPO_DIR="$1"
AGENT="$2"
PROVIDER="$3"
MODEL="$4"
API_KEY="$5"

# Ensure tools are in PATH (derive HOME from REPO_DIR to avoid container HOME issues)
REAL_HOME="${6:-$HOME}"
export HOME="$REAL_HOME"
export PATH="$REAL_HOME/.bun/bin:$REAL_HOME/.hermes/hermes-agent/venv/bin:$REAL_HOME/.local/share/npm/bin:$PATH"

# Resolve uwf and ocas
UWF="bun $REPO_DIR/packages/cli/src/cli.ts"
OCAS="ocas"

PASS=0
FAIL=0
RESULTS=()

run_test() {
  local name="$1"
  shift
  local output exit_code
  echo "--- TEST: $name ---" >&2
  output=$("$@" 2>&1) && exit_code=0 || exit_code=$?
  if [ $exit_code -eq 0 ]; then
    PASS=$((PASS + 1))
    RESULTS+=("{\"name\":\"$name\",\"status\":\"pass\"}")
    echo "  ✅ PASS" >&2
  else
    FAIL=$((FAIL + 1))
    # Escape output for JSON
    local escaped
    escaped=$(echo "$output" | head -5 | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-200)
    RESULTS+=("{\"name\":\"$name\",\"status\":\"fail\",\"error\":\"$escaped\"}")
    echo "  ❌ FAIL: $output" >&2
  fi
  echo "$output"
}

assert_contains() {
  local haystack="$1" needle="$2"
  if echo "$haystack" | grep -q "$needle"; then
    return 0
  else
    echo "Expected to contain: $needle" >&2
    echo "Got: $haystack" >&2
    return 1
  fi
}

assert_json_field() {
  local json="$1" field="$2"
  if echo "$json" | jq -e ".$field" >/dev/null 2>&1; then
    return 0
  else
    echo "Missing JSON field: $field" >&2
    return 1
  fi
}

# ============================================================
# Phase 1: Environment check
# ============================================================
echo "" >&2
echo "=== Phase 1: Environment ===" >&2

run_test "uwf --version" bash -c "$UWF --version"

# ============================================================
# Phase 2: Setup (non-interactive)
# ============================================================
echo "" >&2
echo "=== Phase 2: Setup ===" >&2

if [ -n "$PROVIDER" ] && [ -n "$MODEL" ] && [ -n "$API_KEY" ]; then
  SETUP_CMD="$UWF setup --provider $PROVIDER --base-url https://api.openai.com/v1 --api-key $API_KEY --model $MODEL"
  if [ -n "$AGENT" ]; then
    SETUP_CMD="$SETUP_CMD --agent $AGENT"
  fi
  run_test "uwf setup (non-interactive)" bash -c "$SETUP_CMD"
else
  # Copy host config if available
  if [ -f "$HOME/.uncaged/workflow/config.yaml" ]; then
    cp "$HOME/.uncaged/workflow/config.yaml" "$UNCAGED_WORKFLOW_STORAGE_ROOT/config.yaml"
    echo "  Copied host config.yaml" >&2
  fi
fi

# Test config commands
OUT=$(run_test "uwf config list" bash -c "$UWF config list")
run_test "config list is valid JSON" bash -c "echo '$OUT' | jq . >/dev/null"

# ============================================================
# Phase 3: Workflow registration
# ============================================================
echo "" >&2
echo "=== Phase 3: Workflow registration ===" >&2

# Use the example workflow
EXAMPLE_WF="$REPO_DIR/examples/solve-issue.yaml"
if [ ! -f "$EXAMPLE_WF" ]; then
  echo "No example workflow found, creating minimal test workflow" >&2
  EXAMPLE_WF="/tmp/test-workflow.yaml"
  cat > "$EXAMPLE_WF" << 'WF'
name: test-e2e
roles:
  worker:
    goal: "Respond to the prompt with a brief answer."
    outputSchema:
      type: object
      required: ["$status", "answer"]
      properties:
        $status:
          type: string
          enum: ["done"]
        answer:
          type: string
graph:
  - from: $START
    to: worker
  - from: worker
    condition:
      $status: done
    to: $END
WF
fi

OUT=$(run_test "uwf workflow add" bash -c "$UWF workflow add $EXAMPLE_WF")
run_test "workflow add returns hash" bash -c "echo '$OUT' | jq -e '.hash'"

OUT=$(run_test "uwf workflow list" bash -c "$UWF workflow list")
run_test "workflow list is non-empty" bash -c "echo '$OUT' | jq -e 'length > 0'"

# Get workflow name
WF_NAME=$(echo "$OUT" | jq -r '.[0].name // empty')
run_test "workflow has a name" bash -c "[ -n '$WF_NAME' ]"

OUT=$(run_test "uwf workflow show" bash -c "$UWF workflow show $WF_NAME")
run_test "workflow show returns roles" bash -c "echo '$OUT' | jq -e '.payload.roles'"

# ============================================================
# Phase 4: Thread lifecycle
# ============================================================
echo "" >&2
echo "=== Phase 4: Thread lifecycle ===" >&2

# Start a thread
OUT=$(run_test "uwf thread start" bash -c "$UWF thread start $WF_NAME -p 'E2E test: what is 2+2?'")
THREAD_ID=$(echo "$OUT" | jq -r '.thread // empty')
run_test "thread start returns thread ID" bash -c "[ -n '$THREAD_ID' ]"

# List threads
OUT=$(run_test "uwf thread list" bash -c "$UWF thread list")
run_test "thread appears in list" bash -c "echo '$OUT' | jq -e '.[] | select(.thread==\"$THREAD_ID\")'"

# Show thread
OUT=$(run_test "uwf thread show" bash -c "$UWF thread show $THREAD_ID")
run_test "thread show returns head" bash -c "echo '$OUT' | jq -e '.head'"

# Execute one step
EXEC_ARGS=""
if [ -n "$AGENT" ]; then
  EXEC_ARGS="--agent $AGENT"
fi
OUT=$(run_test "uwf thread exec (1 step)" bash -c "$UWF thread exec $THREAD_ID $EXEC_ARGS")
run_test "thread exec returns step info" bash -c "echo '$OUT' | jq -e '.head'"

# ============================================================
# Phase 5: Read & Inspect
# ============================================================
echo "" >&2
echo "=== Phase 5: Read & Inspect ===" >&2

# Step list
OUT=$(run_test "uwf step list" bash -c "$UWF step list $THREAD_ID")
STEP_COUNT=$(echo "$OUT" | jq '.steps | length')
run_test "step list has steps" bash -c "[ $STEP_COUNT -gt 1 ]"

# Get last step hash
LAST_STEP=$(echo "$OUT" | jq -r '.steps[-1].hash // empty')
run_test "last step has hash" bash -c "[ -n '$LAST_STEP' ]"

# Step show
if [ -n "$LAST_STEP" ]; then
  OUT=$(run_test "uwf step show" bash -c "$UWF step show $LAST_STEP")
  run_test "step show returns role" bash -c "echo '$OUT' | jq -e '.role'"
fi

# Thread read
OUT=$(run_test "uwf thread read" bash -c "$UWF thread read $THREAD_ID")
run_test "thread read produces output" bash -c "[ -n '$OUT' ]"

# CAS operations
if [ -n "$LAST_STEP" ]; then
  OUT=$(run_test "ocas get" bash -c "$OCAS get $LAST_STEP")
  run_test "cas get returns type" bash -c "echo '$OUT' | jq -e '.type'"

  OUT=$(run_test "ocas has" bash -c "$OCAS has $LAST_STEP")

  OUT=$(run_test "ocas refs" bash -c "$OCAS refs $LAST_STEP")

  OUT=$(run_test "ocas walk" bash -c "$OCAS walk $LAST_STEP")
  run_test "cas walk returns nodes" bash -c "echo '$OUT' | jq -e 'length > 0'"
fi

# ============================================================
# Phase 6: Cancel & Fork
# ============================================================
echo "" >&2
echo "=== Phase 6: Cancel & Fork ===" >&2

# Start a second thread for cancel test
OUT=$(run_test "thread start (for cancel)" bash -c "$UWF thread start $WF_NAME -p 'E2E cancel test'")
CANCEL_THREAD=$(echo "$OUT" | jq -r '.thread // empty')

if [ -n "$CANCEL_THREAD" ]; then
  OUT=$(run_test "uwf thread cancel" bash -c "$UWF thread cancel $CANCEL_THREAD")
  run_test "cancelled thread status" bash -c "$UWF thread list --status completed | jq -e '.[] | select(.thread==\"$CANCEL_THREAD\")'"
fi

# Fork from the first thread's last step
if [ -n "$LAST_STEP" ]; then
  OUT=$(run_test "uwf step fork" bash -c "$UWF step fork $LAST_STEP")
  FORK_THREAD=$(echo "$OUT" | jq -r '.thread // empty')
  run_test "fork creates new thread" bash -c "[ -n '$FORK_THREAD' ] && [ '$FORK_THREAD' != '$THREAD_ID' ]"
fi

# ============================================================
# Phase 7: Log inspection
# ============================================================
echo "" >&2
echo "=== Phase 7: Logs ===" >&2

OUT=$(run_test "uwf log list" bash -c "$UWF log list")
OUT=$(run_test "uwf log show" bash -c "$UWF log show --thread $THREAD_ID 2>&1 || true")

# ============================================================
# Phase 8: Config operations
# ============================================================
echo "" >&2
echo "=== Phase 8: Config get/set ===" >&2

OUT=$(run_test "uwf config get defaultAgent" bash -c "$UWF config get defaultAgent")
OUT=$(run_test "uwf config set (test key)" bash -c "$UWF config set models.test.name test-model")
OUT=$(run_test "uwf config get (verify set)" bash -c "$UWF config get models.test.name")
run_test "config set value persisted" bash -c "echo '$OUT' | grep -q 'test-model'"

# ============================================================
# Report
# ============================================================
echo "" >&2
echo "=== Results ===" >&2
echo "Pass: $PASS  Fail: $FAIL" >&2

# JSON report
echo "{"
echo "  \"pass\": $PASS,"
echo "  \"fail\": $FAIL,"
echo "  \"agent\": \"$AGENT\","
echo "  \"tests\": [$(IFS=,; echo "${RESULTS[*]}")]"
echo "}"

[ $FAIL -eq 0 ]
INNER_SCRIPT

chmod +x "$E2E_DIR/run.sh"

# --- Run in Docker ---
echo "Starting Docker container..." >&2

# --- Build bootstrap script (runs first inside container) ---
cat > "$E2E_DIR/bootstrap.sh" << BOOTSTRAP
#!/usr/bin/env bash
set -uo pipefail
echo "Installing jq..." >&2
apt-get update -qq >&2 && apt-get install -y -qq jq >&2
echo "jq installed" >&2

# All tools come from host via mount
export HOME='$HOME'
export PATH="$HOME/.bun/bin:$HOME/.hermes/hermes-agent/venv/bin:$HOME/.local/share/npm/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Ensure bun modules are resolved for this environment
cd '$REPO_DIR'
echo "Running bun install..." >&2
which bun >&2
bun install 2>&1 | tail -3 >&2
echo "bun install done" >&2

# Run E2E (pass HOME explicitly as 6th arg)
bash /e2e/run.sh '$REPO_DIR' '$AGENT' '$PROVIDER' '$MODEL' '$API_KEY' '$HOME'
BOOTSTRAP
chmod +x "$E2E_DIR/bootstrap.sh"

docker run --rm \
  --name "$CONTAINER_NAME" \
  -v "$HOME:$HOME" \
  -v "$E2E_DIR:/e2e" \
  -e HOME="$HOME" \
  -w "$REPO_DIR" \
  node:22-bookworm \
  bash /e2e/bootstrap.sh
