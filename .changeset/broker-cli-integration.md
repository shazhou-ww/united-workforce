---
"@united-workforce/cli": minor
"@united-workforce/protocol": minor
"@united-workforce/util-agent": minor
---

feat(cli, protocol, util-agent): wire broker into `uwf thread exec` (Phase 3 / #380)

Phase 3 of the broker rollout. Replaces the legacy `spawnAgent` /
`executeAgentCommand` / last-stdout-line JSON path in `uwf thread exec`
with a direct `broker.send()` call against the Sumeru HTTP API. The CLI
now drives frontmatter extraction directly on `result.output` rather than
delegating to the broker.

Breaking changes (0.x):

- **`AgentConfig` shape** — `{command, args}` is replaced by
  `{host, gateway}`. `agents.<alias>.command` and `agents.<alias>.args`
  are now rejected by `uwf config set` and by the engine config
  validator. Update existing `~/.uwf/config.yaml` entries:

  ```yaml
  # before
  agents:
    hermes:
      command: uwf-hermes
      args: ["--verbose"]

  # after
  agents:
    hermes:
      host: http://127.0.0.1:7900
      gateway: hermes
  ```

- **`--agent` override** — the inline override accepts an alias from
  `agents.*` OR a `"<host> <gateway>"` pair; the legacy bare-command
  override is removed.

- **`step ask` / `step fork`** — disabled in this phase (deferred to
  Phase 4). The commands return a clear "not yet supported in Phase 3"
  error instead of silently using the legacy path.

Highlights:

- **`executeBrokerStep()`** — single entrypoint that resolves the agent
  route from the config, calls `broker.send({ threadId, role, prompt })`,
  runs the frontmatter fast-path on `result.output`, and persists a
  `StepNode` with the extracted role output schema, edge prompt, and
  accumulated usage.
- **Multi-step session reuse** — the broker SQLite session store rows
  the `(threadId, role) → sessionId` mapping; subsequent steps for the
  same role reuse the cached Sumeru session, with silent retry on stale
  `sumeru_session_not_found`.
- **Resume** — `uwf thread resume` reuses the same Sumeru session via
  the cached row. No new session is created on resume.
- **e2e tests** — new `e2e-broker-step.test.ts` stubs `globalThis.fetch`
  with deterministic Sumeru `createSession` and SSE `sendMessage`
  responses. Verifies the route, frontmatter extraction, persisted
  `StepNode`, and the broker session store row. The legacy
  `e2e-mock-agent`, `thread-poke`, `thread-resume`, `thread-suspend-step`,
  `thread-agent-failure-suspended`, and `step-ask` test suites are
  marked `describe.skip` while their broker equivalents land in later
  phases.
