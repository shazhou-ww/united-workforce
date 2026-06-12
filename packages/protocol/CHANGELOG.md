# Changelog

## 0.3.0 — 2026-06-12

- **BREAKING**: `uwf` CLI commands now emit ocas envelopes (`{ type, value }`) by default, with text rendering as the default format.
  
  Five output formats are supported via `--format`:
  
  | Format | Shape | Use case |
  |--------|-------|----------|
  | `text` (default) | Liquid-rendered human-readable view | Interactive terminal use |
  | `json` | `{"type": "<schemaHash>", "value": <payload>}` | Self-describing JSON for downstream parsers |
  | `yaml` | YAML envelope (type, value keys) | Self-describing YAML |
  | `raw-json` | bare `<payload>` | **0.5.0 backward compat** — drop-in replacement for old `json` |
  | `raw-yaml` | bare `<payload>` | **0.5.0 backward compat** — drop-in replacement for old `yaml` |
  
  Migration: scripts that consumed `uwf ... --format json` (parsing the bare value) must switch to `--format raw-json` to preserve the previous output shape, or update their parsers to read from the `value` field of the envelope.
  
  New protocol exports:
  - `OUTPUT_SCHEMAS` map and individual `*_OUTPUT_SCHEMA` constants for the 9 CLI output schemas (thread-start, thread-status, thread-list, thread-exec, step-detail, step-list, workflow-detail, workflow-list, validate-result)
  - `OUTPUT_TEMPLATES` map and `outputSchemaVarName(name)` helper
  
  The CLI registers all output schemas and `@ocas/template/text/<schemaHash>` templates idempotently on first use via `registerUwfSchemas`.
  
  `uwf workflow validate` now emits a structured `validate-result` envelope on stdout (`✓ valid` / `✗ invalid (N errors)`) instead of writing errors to stderr; exit codes are preserved (0 for valid, 1 for invalid).
  
  **In-repo consumer migration** (`@united-workforce/eval` patch): the eval runner (`runner/execute.ts`) and the builtin judges (`judge/builtin/read-steps.ts`, `frontmatter.ts`, `token-stats.ts`) now invoke the CLI with `--format raw-json` and read the new payload field names (`threadId`, `workflowHash`, `items`, `steps`). The `step list` payload no longer contains a synthetic start entry, so the judges drop the legacy `.slice(1)` and fetch per-step `frontmatter`/`usage` via a follow-up `uwf step show <hash>` call. Repo helper scripts `scripts/e2e-walkthrough.sh` and `scripts/batch-solve.sh` were migrated in lockstep (jq/python paths updated to match the new payload shape).
- Fix `uwf workflow add` defaulting to raw JSON output (issue #334).
  
  `workflow add` was the only data-producing CLI command that did not migrate
  to the per-command renderer registry introduced in #329. It still called
  `writeRawOutput(result)`, so the default `--format text` printed
  `{"name":"...","hash":"..."}` raw JSON instead of human-readable text.
  
  Changes:
  
  - New `WORKFLOW_ADD_OUTPUT_SCHEMA` registered under `@uwf/output/workflow-add`
    with `name` and `hash` string fields (`additionalProperties: false`).
  - New `OUTPUT_TEMPLATES["workflow-add"]` Liquid template renders the result
    as labelled key-value lines:
  
    ```
    Registered  review-pr
    Hash        2TBP6T37TZAJZ
    ```
  
  - New `WorkflowAddPayload` type and `toWorkflowAddPayload` mapper in
    `@united-workforce/cli/src/output-mappers.ts`.
  - The `workflow add` action now calls
    `writeOutput(toWorkflowAddPayload(result), "workflow-add", storageRoot)`
    so all five formats (`text`, `json`, `yaml`, `raw-json`, `raw-yaml`) are
    honored consistently with every other data-producing command.
- Fix `uwf thread list --format text` rendering year `58414-12-06` (issue #351). The `THREAD_LIST_TEMPLATE` in `packages/protocol/src/output-templates.ts` piped `item.startedAt` (Unix milliseconds, per `THREAD_LIST_OUTPUT_SCHEMA`) directly into LiquidJS's `| date` filter, which expects Unix seconds. The template now converts ms→s via `| divided_by: 1000` before `| date`, so `STARTED` cells render correctly (e.g. `2026-06-12 05:25`). Adds protocol-level regression-guard tests that reject any future template piping a ms-typed schema field (`startedAt`, `completedAt`, `startedAtMs`, `completedAtMs`, `timestamp`) into `| date` without prior conversion.

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

