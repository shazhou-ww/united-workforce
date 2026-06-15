---
scenario: "uwf-claude-code surfaces captured claude subprocess stderr in the failure error so users can diagnose root cause"
feature: agent-claude-code
tags: [agent, claude-code, stderr, error-handling]
---

## Given

- `uwf-claude-code` is configured as the agent.
- `spawnClaude()` in `packages/agent-claude-code/src/claude-code.ts` captures both `stdout` and `stderr` from the `claude` subprocess.
- The `claude` subprocess writes a diagnostic message to `stderr` (e.g. `Not logged in · Please run /login`, an API key error, or any other CLI error) and exits with a non-zero code.

## When

- The subprocess `close` event fires with a non-zero exit code AND `stderr` contains non-empty content.

## Then

- The rejection produced by `spawnClaude()` MUST include the captured `stderr` text in the resulting `Error.message`.
- When the `stderr` matches a known pattern, the captured `stderr` MAY be replaced by the mapped message defined in `agent-claude-code-error-mapping.md`. When the stderr does NOT match a known pattern, the raw `stderr` (trimmed, truncated to a reasonable length) MUST appear verbatim in the error message.
- When `stderr` is empty, the error MUST still include the exit code (e.g. `claude exited with code 1`).
- When `processClaudeOutput()` is called and parsing fails (no parseable result), the error MUST include exit code, captured stderr (first 200 chars), and stdout snippet (first 200 chars) — this matches the existing fallback behavior in `processClaudeOutput()`.
- The captured stderr text MUST be available to the calling agent harness (`createAgent`) so that `uwf thread exec` reports it in its `agent run failed: ...` message.
- A unit test asserts that for an exit-code 1 with `stderr = "Not logged in · Please run /login"`, the error message contains both the mapped actionable text and (optionally) the original stderr snippet.
