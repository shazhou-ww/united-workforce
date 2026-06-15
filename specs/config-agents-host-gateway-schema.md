---
scenario: "AgentConfig schema migrates from {command, args} to {host, gateway} as a 0.x breaking change with no auto-migration"
feature: config
tags: [config, breaking-change, agents, broker, schema]
---

## Given
- `~/.uwf/config.yaml` is the engine config file written by `uwf setup` and `uwf config set`
- Pre-Phase-3 the `agents.<alias>` block stores `{command: string, args: string[]}` (the CLI binary path and argv prefix)
- Phase 3 is a deliberate 0.x breaking change — node operators (KUMA / RAKU / SORA / 小糯) migrate by hand; the engine performs **no** automatic translation

## When
- Phase 3 lands and an operator regenerates `~/.uwf/config.yaml` (manually or via `uwf setup`)

## Then
- `AgentConfig` in `@united-workforce/protocol` is redefined as
  ```typescript
  export type AgentConfig = {
    host: string;     // e.g. "http://127.0.0.1:7900"
    gateway: string;  // e.g. "claude-code"
  };
  ```
  (still `type`, no optional `?:`, named export)
- `WorkflowConfig.agents: Record<AgentAlias, AgentConfig>` now carries the new shape; `defaultAgent` and `agentOverrides` are unchanged
- The legacy `command` / `args` fields are removed from `AgentConfig` — no `command?: string` compatibility shim
- `VALID_CONFIG_KEYS.agents.knownFields` in `packages/cli/src/commands/config.ts` is updated to `["host", "gateway"]` so `uwf config set agents.<name>.command ...` rejects with: `Unknown field 'command' in agents. Valid fields are: host, gateway`
- `loadWorkflowConfig` (in `@united-workforce/util-agent`) loads the new schema:
  - When a config value contains `command` / `args` instead of `host` / `gateway`, the load fails with a clear error referring the operator to the Phase-3 migration notes (no silent fallback)
  - When `host` is missing or empty, fails with `agents.<alias>.host is required`
  - When `gateway` is missing or empty, fails with `agents.<alias>.gateway is required`
- Setup (`uwf setup`) writes the new shape only — the interactive flow asks for host + gateway (defaults `http://127.0.0.1:7900` / `<alias>`) instead of a binary path
- `uwf config get agents.<alias>` prints the new shape (`host: ...`, `gateway: ...`)
- A short migration note is added to `packages/cli/README.md` (or equivalent operator-facing doc) explaining the manual rewrite — this is the only place the legacy shape is referenced
- `pnpm run build`, `pnpm run check`, `pnpm run typecheck`, `pnpm run test` all pass after the schema change
