# Changelog

## 0.2.0 — 2026-06-11

- feat: record failed steps in CAS and track retry lineage
  
  When an agent step fails (e.g. frontmatter validation failure), the step is now
  written to CAS with `$status: "error"` preserving turns and usage data. The thread
  head is NOT advanced, so moderator routing is unaffected.
  
  On successful retry, the new step's detail records `previousAttempts` linking to
  prior failed step hashes, enabling complete attempt history visibility.
- refactor: remove engine-level LLM config — each adapter owns its own LLM (#143)
  
  The engine config (`config.yaml`) is now LLM-free. Workflow execution no longer
  knows or cares about LLM providers, models, or API keys. Each agent adapter is
  responsible for loading its own LLM configuration from a path it owns.
  
  **Breaking changes:**
  
  - `@united-workforce/protocol` — `WorkflowConfig` is narrowed to
    `{ agents, defaultAgent, agentOverrides }`. The types `ProviderConfig`,
    `ModelConfig`, `ModelAlias`, `ProviderAlias`, and `Scenario` have been
    removed.
  - `@united-workforce/util-agent` — `extract`, `ExtractResult`,
    `ResolvedLlmProvider`, `resolveExtractModelAlias`, and `resolveModel` are no
    longer exported. The `extract.ts` module has been deleted. Adapters that
    previously called `resolveModel(config, …)` must load their own LLM config.
  - `@united-workforce/agent-builtin` — the builtin adapter now reads its LLM
    config from `<storageRoot>/agents/builtin.yaml` via the new
    `loadBuiltinLlmConfig(storageRoot)` function (also exported). The expected
    YAML shape is `{ provider: { baseUrl, apiKey }, model }`. `ResolvedLlmProvider`
    now lives in `@united-workforce/agent-builtin`.
  - `@united-workforce/cli` — `uwf setup` no longer accepts
    `--provider/--base-url/--api-key/--model`. It only takes an optional
    `--agent`. `VALID_CONFIG_KEYS` for `uwf config get/set` no longer accepts
    `providers`, `models`, `defaultModel`, or `modelOverrides`. Existing config
    files with those legacy fields are still loadable — the engine ignores them.
- Update documentation and type annotations from Mustache to Liquid terminology (Phase 2 of LiquidJS migration)
- refactor: rename ThreadStatus "completed" → "end" (#186)
  
  **Breaking:** `ThreadStatus` no longer includes `"completed"`. The terminal status for threads that reach `$END` is now `"end"`.
  
  - `ThreadStatus` union: `"idle" | "running" | "suspended" | "end" | "cancelled"`
  - `completeThread()` and `markThreadCompleted()` now accept `"end" | "cancelled"` (was `"completed" | "cancelled"`)
  - `--status completed` CLI filter is replaced by `--status end`
  - Legacy on-disk data with `status: "completed"` is silently normalized to `"end"` on read
  
  **Why:** `$END` is a neutral terminal state — success, failure, or guard-blocked all route there. "completed" misleadingly implies success. "end" is neutral and matches the `$END` pseudo-role name.
- feat(workflow)!: `$SUSPEND` becomes an engine-level reserved `$status` (coroutine yield)
  
  `$SUSPEND` is no longer a graph pseudo-role. Instead, any role may emit
  `{ $status: "$SUSPEND", reason: string }` from its output. The engine intercepts
  this status before the moderator: the step is written to CAS normally (head
  advances), the thread is marked `suspended` with the role and reason, and
  `thread resume` re-runs the same role — exactly like a coroutine yielding control
  back to its caller.
  
  For any role with frontmatter type `F`, the effective output type is
  `F | { $status: "$SUSPEND", reason: string }`. Suspend outputs are validated
  against a dedicated reserved schema, bypassing the role's own frontmatter schema.
  
  Adapters now yield instead of failing on resource limits:
  - `agent-claude-code`: an `error_max_turns` result emits `$SUSPEND` (preserving
    all turns and usage) instead of throwing.
  - `agent-hermes`: a prompt timeout emits `$SUSPEND` instead of rejecting.
  
  BREAKING CHANGE: `"$SUSPEND"` is removed from `GraphPseudoRole` and is no longer a
  valid graph target role. Workflows using the old `role: "$SUSPEND"` edge pattern
  now fail validation with a migration hint — emit `$status: "$SUSPEND"` from the
  role output instead.
- Add `version` field to workflow YAML format. `WorkflowPayload` now includes a top-level `version: number` (integer). Legacy YAML without `version` falls back to `1`; `uwf workflow add` warns when the field is missing. All in-repo workflow YAML files updated to `version: 1`. Fixes #294.

