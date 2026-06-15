---
scenario: "uwf config set rejects the legacy agents.<alias>.command and agents.<alias>.args fields with a Phase-3 migration error message"
feature: config
tags: [config, validation, breaking-change, agents, migration]
---

## Given
- Phase 3 has shipped — `VALID_CONFIG_KEYS.agents.knownFields` in `packages/cli/src/commands/config.ts` is `["host", "gateway"]`

## When
- An operator (or a stale automation) runs one of:
  - `uwf config set agents.claude-code.command /usr/local/bin/uwf-claude-code`
  - `uwf config set agents.hermes.args '["--profile","prod"]'`
  - `uwf config set agents.foo.something_else "x"`

## Then
- The CLI exits non-zero before mutating `~/.uwf/config.yaml`
- The error message reads exactly: `Unknown field 'command' in agents. Valid fields are: host, gateway` (or `'args'` / `'something_else'` as appropriate) — matches the existing `validateConfigKey` failure pattern
- `~/.uwf/config.yaml` is not modified — `loadConfig` / `saveConfig` are not invoked on the failure path
- Conversely, `uwf config set agents.claude-code.host http://127.0.0.1:7900` and `uwf config set agents.claude-code.gateway claude-code` succeed and write the expected YAML
- `uwf config set agents.claude-code` (depth 2) fails with the existing `Incomplete path for agents` message, with the field list updated to `host, gateway`
- `loadWorkflowConfig` (used by `thread exec`) refuses to start a step when `agents.<alias>` carries a `command` key — the message points the operator at the migration note. This makes a stale config fail loudly the first time it is used, not silently after a change
- A changeset entry under `.changeset/` notes the breaking change to `@united-workforce/protocol` (`AgentConfig` shape) and `@united-workforce/cli` (config validation), and instructs operators on the manual rewrite
