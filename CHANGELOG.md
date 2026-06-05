# Changelog

## 0.1.0 (2026-06-05)

Initial release of `@united-workforce/*` — a stateless workflow engine for AI agent orchestration.

### Packages

- **@united-workforce/protocol** — shared types (WorkflowPayload, StepNode, etc.)
- **@united-workforce/util** — Crockford Base32, ULID, structured logger, frontmatter parsing
- **@united-workforce/util-agent** — agent factory, context builder, extract pipeline
- **@united-workforce/cli** — `uwf` CLI (thread lifecycle, status-based moderator, workflow registry)
- **@united-workforce/eval** — `uwf-eval` CLI (prepare → execute → collect eval pipeline)
- **@united-workforce/agent-hermes** — `uwf-hermes` adapter (Hermes Agent)
- **@united-workforce/agent-claude-code** — `uwf-claude-code` adapter (Claude Code CLI)
- **@united-workforce/agent-builtin** — `uwf-builtin` adapter (built-in LLM agent)
- **@united-workforce/agent-mock** — `uwf-mock` adapter (deterministic test agent)

### Highlights

- Status-based graph routing (no LLM moderator cost)
- CAS-backed immutable thread chains (`@ocas/core`)
- Real token usage tracking (Hermes + Claude Code)
- Eval framework with built-in judges (frontmatter, token-stats, test-pass)
- `$SUSPEND` / resume for human-in-the-loop workflows
