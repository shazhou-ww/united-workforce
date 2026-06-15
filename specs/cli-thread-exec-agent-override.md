---
scenario: "uwf thread exec --agent <override> resolves under the new {host, gateway} shape — alias lookup first, then inline host+gateway"
feature: thread
tags: [cli, thread-exec, agent-override, broker]
---

## Given
- `~/.uwf/config.yaml` declares two agents under the new shape:
  ```yaml
  defaultAgent: claude-code
  agents:
    claude-code:
      host: http://127.0.0.1:7900
      gateway: claude-code
    hermes:
      host: http://127.0.0.1:7900
      gateway: hermes
  ```
- A thread `06FCJ...` is at an idle step

## When
- The user runs `uwf thread exec 06FCJ... --agent <override>` with one of the override forms below

## Then
- **Alias form** — `--agent hermes`:
  - `resolveAgentConfig(config, workflow, role, "hermes")` returns `config.agents.hermes` → `{host: "http://127.0.0.1:7900", gateway: "hermes"}`
  - Broker uses host+gateway to send via the hermes gateway for this exec only
  - The session map key remains `(threadId, role)` — the override does NOT include the alias in the cache key, so toggling `--agent` between execs may reuse a session created on a different gateway. This is accepted in Phase 3 (Phase 4 may revisit)
- **Inline `host gateway` form** — `--agent "http://example:7900 claude-code"`:
  - `parseAgentOverride("http://example:7900 claude-code")` returns `{host: "http://example:7900", gateway: "claude-code"}` (positional, exactly two whitespace-separated tokens after trimming)
  - Broker routes to that host+gateway pair for this exec only
  - More than 2 tokens or fewer than 2 tokens fails fast with: `agent override must be an alias or "<host> <gateway>"`
  - Empty override fails with: `agent override must not be empty` (matches current behaviour)
- **Unknown alias** — `--agent does-not-exist`:
  - First attempts alias lookup (`config.agents["does-not-exist"]` is `undefined`)
  - Falls through to `parseAgentOverride("does-not-exist")` which has only one token → fails with: `agent override must be an alias or "<host> <gateway>"`
  - The CLI exits non-zero before attempting any HTTP I/O
- The legacy interpretation — treating `--agent uwf-hermes` as a CLI binary path — is **removed**. Strings that used to mean a binary now fail unless they happen to be a valid alias
- `--agent` does not write to `~/.uwf/config.yaml`; it only overrides for the current invocation
- `--agent` overrides `agentOverrides.<workflow>.<role>` for the duration of this exec (existing precedence preserved)
