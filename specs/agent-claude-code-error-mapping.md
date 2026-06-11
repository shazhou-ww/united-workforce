---
scenario: "uwf-claude-code maps known claude subprocess failures to actionable error messages"
feature: agent-claude-code
tags: [agent, claude-code, error-handling, stderr]
---

## Given

- `uwf-claude-code` is configured as the agent (via `--agent uwf-claude-code` or `defaultAgent: claude-code`).
- A thread step is being executed (`uwf thread exec <thread-id>`).
- The `claude` subprocess spawned by `packages/agent-claude-code/src/claude-code.ts` exits with a non-zero code.
- `spawnClaude()` captured the subprocess `stderr` content.

## When

- The `claude` subprocess exits with code `1` AND the captured `stderr` contains the substring `Not logged in` (case-insensitive match against the message `Not logged in · Please run /login`).
- OR the `claude` subprocess exits with code `1` AND the captured `stderr` contains an API key error pattern (e.g. `invalid api key`, `ANTHROPIC_API_KEY`, `authentication`, `unauthorized`).
- OR the `claude` subprocess exits with any other non-zero code with non-empty `stderr`.

## Then

- The thrown `Error` produced by `spawnClaude()` (or its caller) MUST contain a human-readable, actionable message:
  - For "Not logged in": the error message MUST include the text `Claude Code is not logged in. Run \`claude login\` first.`
  - For API key errors: the error message MUST include the text `Claude Code API key error. Check your API key configuration.`
  - For other non-zero exits: the error message MUST include both the exit code and the captured `stderr` (truncated to a reasonable length, e.g. first 500 chars). Example: `claude exited with code 2: <stderr snippet>`.
- The error message MUST NOT contain the full assembled prompt.
- The agent process exits non-zero so the parent `uwf thread exec` reports the failure.
- The mapping is implemented as a pure helper function in `packages/agent-claude-code/src/claude-code.ts` (e.g. `mapClaudeError(exitCode, stderr): string`) so that it can be unit-tested without spawning a subprocess.
- A unit test in `packages/agent-claude-code/__tests__/claude-code.test.ts` covers each mapped case (`Not logged in`, API key error, generic non-zero exit) and asserts the produced error message text.
