---
scenario: "uwf-claude-code only emits the assembled prompt at debug log level, never as primary error context"
feature: agent-claude-code
tags: [agent, claude-code, logging, debug, error-handling]
---

## Given

- `uwf-claude-code` is configured as the agent.
- `packages/agent-claude-code/src/claude-code.ts` builds an assembled prompt via `buildClaudeCodePrompt(ctx)` (typically several thousand characters long).
- A thread step is being executed.
- The structured logger `createLogger({ sink: { kind: "stderr" } })` is the only logging channel for this package.

## When

- `runClaudeCode(ctx, model)` is invoked AND
- The `claude` subprocess fails with a non-zero exit code (e.g. authentication failure, API key failure, generic failure).

## Then

- The full assembled prompt MUST NOT appear in the thrown `Error` message produced by the agent.
- The full assembled prompt MUST NOT appear in any log entry whose level is `info`, `warn`, or `error` — it is permitted only at `debug` level (or guarded by an explicit debug check).
- The pre-existing log call with tag `K7R2M4N8` (`prompt for role=...`) which currently logs the entire prompt unconditionally MUST be either:
  - Demoted to a debug-only log, OR
  - Replaced with a short summary log (role + prompt length only) and the full prompt body emitted only when a debug flag is set.
- When `claude` exits non-zero, the primary error surfaced to the user is the mapped, actionable message (see `agent-claude-code-error-mapping.md`), NOT the assembled prompt.
- A regression test verifies that on non-zero exit the thrown error string length is bounded (e.g. ≤ 1000 chars) and does not contain the marker substring `## Task` from the assembled prompt template.
