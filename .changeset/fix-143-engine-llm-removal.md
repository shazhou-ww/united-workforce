---
"@united-workforce/protocol": minor
"@united-workforce/util-agent": minor
"@united-workforce/agent-builtin": minor
"@united-workforce/cli": minor
---

refactor: remove engine-level LLM config — each adapter owns its own LLM (#143)

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
