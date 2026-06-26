# Changelog

## 0.4.0 — 2026-06-26

- fix(frontmatter): trim leading whitespace before the fence check (#429)
  
  Frontmatter extraction previously required the agent output to begin at
  character position 0 with `---`, tolerating no leading characters. Both
  independent fence detectors used a bare `startsWith("---")`:
  
  - `splitFrontmatter()` in `@united-workforce/util` (main parse path)
  - `extractYamlBlock()` in `@united-workforce/util-agent` (raw-field recovery)
  
  Agents (claude-code especially) routinely emit a leading newline, space, or
  BOM before the frontmatter, so `startsWith("---")` was `false`, extraction
  failed, and the engine fired a `frontmatter retry` — a full extra agent round
  on the slowest steps.
  
  Both detectors now `trimStart()` the leading whitespace (newline / CR / space /
  tab / BOM `\uFEFF`) before checking the opening fence, in lockstep so the main
  parse and `parseRawFrontmatterFields` never disagree (no dropped fields). The
  block itself must still be a complete `---\n...\n---`, and the body is computed
  from the stripped string so its content is not corrupted.
  
  Scope is the trim layer only — leading prose, markdown code-fence wrapping, and
  regex full-text scanning remain intentionally unhandled. Clean-top outputs parse
  byte-for-byte as before (zero regression).
- chore(cleanup): archive legacy per-agent CLI adapters (#381)
  
  Phase 4 cleanup of the broker rollout. The per-agent CLI binary packages
  (`agent-hermes`, `agent-claude-code`, `agent-sumeru`) have moved out of
  `packages/` into `legacy-packages/` and are no longer published — Sumeru
  gateways are now reached through `@united-workforce/broker` over HTTP.
  
  - `@united-workforce/util-agent` public surface trimmed to the symbols
    still consumed by `cli`, `broker`, `agent-builtin`, and `agent-mock`.
    The per-agent SQLite session cache, external-CLI continuation prompt
    builder, thread-progress hint, `buildContext`, `buildSuspendOutput`,
    the argv parser, and the fork/cleanup adapter type aliases are no
    longer exported (they live in the archived adapters).
  - `@united-workforce/util` skill references (`uwf prompt usage` and
    `uwf prompt adapter-developing`) rewritten so the rendered SKILL.md
    describes the broker-based architecture instead of recommending
    per-agent CLI binary installs.
  - `@united-workforce/cli` setup/prompt commands no longer scan for or
    recommend the per-agent CLI binaries; the `setup --agent` option
    description in `cli.ts` was also updated so `uwf setup --help`
    contains no legacy adapter substrings.
  - `@united-workforce/eval`'s `eval run --agent` default flipped from
    the now-archived `uwf-hermes` to `uwf-builtin` so the default flow
    stays runnable post-cleanup.
  - `scripts/publish-all.mjs` `publishOrder` updated to drop legacy
    adapter dirs and use the post-rename workspace package directories.
  - Repo-root `vitest.config.ts` excludes `legacy-packages/**` so archived
    adapter test files do not run in the workspace test pass.
  - Top-level `README.md` Architecture / Packages sections rewritten to
    match the post-cleanup layout (broker added to Layer 3, archived
    adapters moved into a dedicated Archived table that links into
    `legacy-packages/`). `legacy-packages/agent-sumeru/CHANGELOG.md`
    added so all three archived packages carry the same banner.

## 0.3.0

### Minor Changes

- aeb2449: feat(cli, protocol, util-agent): wire broker into `uwf thread exec` (Phase 3 / #380)

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

  Documentation:

  - **`packages/cli/README.md`** — overview rewritten to describe the
    broker / Sumeru HTTP path, plus a new "Breaking Changes (Phase 3 /
    #380)" migration section covering the `{command, args}` →
    `{host, gateway}` rewrite, the new `--agent` override semantics, and
    the `step ask` / `step fork` deferral.
  - **Root `README.md`** — overview paragraph rewritten so it no longer
    describes agents as spawned CLI subprocesses; `--agent` quick-start
    hint updated to use the new alias / `"<host> <gateway>"` syntax.
  - **`@united-workforce/util` (patch)** — `usage-reference`,
    `cli-reference`, and `adapter-developing-reference` (the bodies
    surfaced by `uwf prompt usage` / `uwf prompt adapter-developing`)
    updated to use the new `--agent` syntax and the `{host, gateway}`
    agent registration sample. `prompt.ts` bootstrap text aligned with
    the same shape.

### Patch Changes

- Updated dependencies [aeb2449]
  - @united-workforce/protocol@0.4.0
  - @united-workforce/util@0.2.1

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
