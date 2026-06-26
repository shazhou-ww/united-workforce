# Changelog

## 0.5.0 — 2026-06-26

- fix(cli): step show now includes StepNode metadata (role, agent, timing, usage)
  
  `step show` previously returned only the expanded detail node (broker-detail),
  which lacks StepNode metadata. Now returns a merged object with `hash`, `role`,
  `agent`, `status`, `startedAtMs`, `completedAtMs`, `durationMs`, `usage`, and
  `detail` (the expanded broker-detail). The `frontmatter` and `turns` fields
  remain accessible under the `detail` key.
  
  Fixes #392
- test(#403): guard `step show` text rendering of the `--- Content ---` turn block
  
  `uwf step show` (text) renders turns via `STEP_DETAIL_TEMPLATE` (post-#394) fed
  by the `toStepDetailPayload` mapper, which flattens `detail.turns` into a
  **top-level** `turns` array. That path shipped with no test asserting the
  rendered text actually contains the turn bodies, so a stale build (the published
  `protocol@0.4.0` predates #394) or an accidental retarget to `detail.turns`
  would go undetected — the defect behind issue #403.
  
  Adds two regression guards (no production code change; the source template and
  mapper were already correct at HEAD):
  
  - `packages/cli/src/__tests__/step-show-text.test.ts` — exercises the full text
    path `cmdStepShow → toStepDetailPayload → writeEnvelope(text) →
    renderEnvelopeText` and asserts the rendered output contains `--- Content ---`,
    each turn's `content` substring, the `Turns   N` line, the `Usage` line, and
    omits the block cleanly for zero-turn steps.
  - `packages/protocol/src/__tests__/output-templates-step-detail.test.ts` — pins
    `STEP_DETAIL_TEMPLATE` to the top-level `turns` / `usage` / `durationMs` shape
    (positive + anti-regression static invariants forbidding `detail.turns`) and
    renders it against a representative payload. Adds `liquidjs` as a protocol
    devDependency for the render assertions.
  
  Both fail against the pre-#394 5-line template and pass at HEAD. The patch bumps
  re-publish the corrected template and ship the guards to the released `uwf`
  binary.
  
  Fixes #403
- Add Turn Chain storage layer foundation (Phase 1)
  
  **Protocol Package:**
  - Add `StepStartPayload` type for step initiation markers (role, edgePrompt, stepIndex, prev, start, startedAtMs, cwd)
  - Add `StepCompletePayload` type for step completion records (startRef, output, detail, completedAtMs, usage, previousAttempts)
  - Add `TurnNodePayload` type for turn nodes with prev/owner linking (role, content, prev, owner)
  - Add JSON schemas `STEP_START_SCHEMA`, `STEP_COMPLETE_SCHEMA`, `TURN_NODE_SCHEMA` for CAS validation
  
  **CLI Package:**
  - Register new schemas in `UwfSchemaHashes` (stepStart, stepComplete, turnNode)
  - Add `writeStepStart(store, payload)` to create step-start nodes linked via prev pointer
  - Add `writeTurnNode(store, payload)` to create turn nodes with prev/owner linking
  - Add `walkTurnChain(store, headHash)` to traverse turn chain in chronological order
  - Add `turnsOfStep(store, headHash, stepStartHash)` to filter turns by step ownership
  - Support legacy turn nodes (prev/owner = null) without breaking existing data
- Turn chain Phase 2 (#419): broker-step producer改造 and active var thread-keyed transition
  
  - **Step-start/step-complete dual nodes**: `executeBrokerStep` now writes a step-start node at entry (before broker.send) and clears the active-step var at completion. This enables crash recovery isolation and in-flight step detection.
  
  - **Thread-keyed active vars**: Replaced role-keyed `@uwf/active-turns/<tid>/<role>` with thread-keyed vars:
    - `@uwf/active-step/<tid>`: Current in-flight step-start hash (cleared on completion)
    - `@uwf/active-turn-head/<tid>`: Head of the turn chain (persists after completion)
  
  - **Turn chain with prev+owner**: Each turn node now includes:
    - `prev`: Pointer to previous turn (forms global turn chain)
    - `owner`: Reference to owning step-start (enables filtering by step)
  
  - **Detail node simplified**: Removed `turns` array from detail node. Turns are now self-contained via the prev+owner chain. Use `turnsOfStep(turnHead, stepStartHash)` to retrieve turns for a specific step.
  
  - **#412 regression fix**: Same role appearing in multiple rounds now correctly attributes turns to their respective step-starts via the `owner` field, not role name.
  
  Deprecated functions (will be removed in Phase 3):
  - `appendActiveTurn`, `readActiveTurns`, `clearActiveTurns` (role-keyed)
  - `readActiveTurnRoles`, `activeTurnsVarName`
  
  New functions:
  - `setActiveStep`, `getActiveStep`, `clearActiveStep`
  - `setActiveTurnHead`, `getActiveTurnHead`
  - `turnsOfStep`, `walkTurnChain`, `writeStepStart`, `writeTurnNode`

## 0.4.0

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

## 0.3.0 — 2026-06-12

- **BREAKING**: `uwf` CLI commands now emit ocas envelopes (`{ type, value }`) by default, with text rendering as the default format.

  Five output formats are supported via `--format`:

  | Format           | Shape                                          | Use case                                                       |
  | ---------------- | ---------------------------------------------- | -------------------------------------------------------------- |
  | `text` (default) | Liquid-rendered human-readable view            | Interactive terminal use                                       |
  | `json`           | `{"type": "<schemaHash>", "value": <payload>}` | Self-describing JSON for downstream parsers                    |
  | `yaml`           | YAML envelope (type, value keys)               | Self-describing YAML                                           |
  | `raw-json`       | bare `<payload>`                               | **0.5.0 backward compat** — drop-in replacement for old `json` |
  | `raw-yaml`       | bare `<payload>`                               | **0.5.0 backward compat** — drop-in replacement for old `yaml` |

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
