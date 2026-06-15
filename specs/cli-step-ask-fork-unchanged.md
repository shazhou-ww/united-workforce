---
scenario: "step ask and step fork keep their pre-broker behaviour in Phase 3 — broker integration is scoped to thread exec only"
feature: step
tags: [cli, step-ask, step-fork, broker, scope]
---

## Given
- Issue #380 explicitly defers `step ask` and `step fork` to Phase 4 — those commands need session-fork primitives at the Sumeru layer that don't exist yet
- Pre-Phase-3 `step ask` resolves an `AgentConfig` (binary path), spawns the adapter binary, and persists an ask-session id via `setAskSessionId`
- Pre-Phase-3 `step fork` clones a step's CAS chain to start a divergent thread; it does not invoke an agent

## When
- Phase 3 lands and the user runs `uwf step ask <thread-id> -p "..."` or `uwf step fork <step-hash>`

## Then
- `cmdStepAsk` and `cmdStepFork` are **not** rewritten to call `broker.send()` in Phase 3
- One of the following holds (pick at code-review time, both satisfy the issue):
  - **Option A (preserve)**: `step ask` continues to use the legacy spawn-agent path on a "legacy adapter" config. Because `AgentConfig` no longer carries `command/args`, the legacy path is wrapped behind a separate config block (e.g. `agentsLegacy: Record<AgentAlias, {command, args}>`) that ONLY `step ask` reads, OR
  - **Option B (disable)**: `step ask` returns a clear error explaining the command is unavailable in 0.x while broker integration is in progress and points the user at #381 / Phase 4. Exit code is non-zero. `step fork` continues to work because it never invoked an agent
- `step fork`'s CAS-chain logic is unchanged — it does not depend on agent invocation and continues to work identically
- Whichever option is chosen, the test suite covers it:
  - `packages/cli/src/__tests__/step-ask.test.ts` is updated to assert the chosen behaviour (success on legacy path, or descriptive failure with the documented exit code)
  - `step fork` tests pass without modification
- `tea pr` review feedback for Phase 3 explicitly notes which option was taken so Phase 4 picks up from a known starting point
- No `step ask` / `step fork` invocation queries the broker session store — those commands do not write `(threadId, role)` rows
