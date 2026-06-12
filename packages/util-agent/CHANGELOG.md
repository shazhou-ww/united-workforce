# Changelog

## 0.2.1 — 2026-06-12

- fix: rename `$body` to `_body` for LiquidJS compatibility
  
  PR #262 replaced Mustache with LiquidJS but `$body` uses a `$` prefix which is
  invalid in Liquid template syntax. Rename the engine-injected variable from
  `$body` to `_body` so edge prompt templates work correctly.
  
  - `thread.ts`: inject `_body` instead of `$body`
  - `validate-semantic.ts`: remove `sanitizeReservedVars` workaround, add `_body` to mock data for strict validation
  - `workflow-authoring-reference.ts`: update docs to `_body`
  - `socratic-questioning.yaml`: update template references
  - `build-thread-progress`: add optional `threadId` parameter so agents can reference their own thread ID

## 0.2.0 — 2026-06-11

- feat(util-agent): extend AgentOptions with `fork` / `cleanup` and add ask-session cache
  
  Phase 2a infrastructure for `step ask`. Extends `AgentOptions` with
  `fork: AgentForkFn | null` and `cleanup: AgentCleanupFn | null` fields, exporting
  the new `AgentForkFn` and `AgentCleanupFn` type aliases. Adds `getAskSessionId` /
  `setAskSessionId` to the per-agent session cache, using `<stepHash>:ask` keys
  that share the cache file with exec sessions (`<threadId>:<role>` keys) without
  collision. All four adapters (mock, builtin, hermes, claude-code) now pass
  `fork: null, cleanup: null` — real implementations land in Phase 2b. Resolves
  issue #145.
- refactor(util-agent): hoist `buildSuspendOutput` into `util-agent`
  
  The `buildSuspendOutput(reason)` helper that produces the `$SUSPEND` frontmatter
  wire format was duplicated in both `agent-claude-code` and `agent-hermes`. Extract
  it into `@united-workforce/util-agent` (next to `trySuspendFastPath`) so the
  producer and consumer of the suspend wire format live in one place. Both adapters
  now import it; the obsolete local copies and now-unused `SUSPEND_STATUS` imports
  are removed. No user-visible behavior change.
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
- fix: accumulate usage across frontmatter retries instead of overwriting
  
  Previously, when a frontmatter retry was triggered via `options.continue()`,
  the `agentResult` was overwritten — recording only the 1-turn correction
  usage instead of the full primary run. Now `mergeUsage()` sums turns,
  inputTokens, outputTokens, and duration across the primary run and all
  retries, so `StepRecord.usage` reflects total resource consumption.
- Refactor to reduce cognitive complexity in spawnAgent and createAgent main functions. Extract helper functions to pass Biome's noExcessiveCognitiveComplexity check (limit 15). Fix array formatting in thread status filter.

## 0.1.2 — 2026-06-07

- fix: decouple session resume from isFirstVisit guard
  
  When frontmatter validation fails, the step is never written to CAS, so isFirstVisit remains true on the next run. Both adapters now always check the session cache regardless of isFirstVisit. When resuming after a frontmatter-only failure (isFirstVisit + cache hit), a minimal correction prompt is sent via buildFrontmatterRetryPrompt() instead of re-sending the full initial prompt.

