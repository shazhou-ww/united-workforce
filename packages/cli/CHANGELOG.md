# @united-workforce/cli

## 0.6.1

### Patch Changes

- 621782c: chore: remove all bun residuals from scripts, examples, and source comments — unified on pnpm/node

## 0.6.0 — 2026-06-14

- Fix: agent step failure now transitions thread to suspended instead of idle

  When an agent step fails (either recoverable `isError: true` or fatal command crash),
  the thread now enters `suspended` status with `suspendedRole` and `suspendMessage` set,
  making failures visible to supervisors via `uwf thread list --status suspended`.

  Previously, agent failures left the thread in `idle` status, hiding the failure.
  Threads suspended by agent failure can be resumed with `uwf thread resume -p "..."`.

- Fix config list/get/set commands to use text renderers when `--format text` is specified. Previously these commands always output raw JSON regardless of format. Now `config list` renders flattened dot-notation key-value pairs, `config get` renders the bare value (or flattened object), and `config set` renders a `key = value` confirmation line.
- feat: add `uwf thread join <thread-id>` command

  Blocks until a running thread finishes, then returns the final result in the
  same `StepOutput[]` format as `uwf thread exec`. Supports `--timeout <seconds>`
  to abort the wait.

  Fixes #365

- feat: workflowPaths — global search paths for workflow discovery

  Add `workflowPaths` config key to `~/.uwf/config.yaml` that supports a list of global search directories for workflow discovery. Resolution order: local `.workflows/` → `workflowPaths` directories → registry (deprecated). Deprecate `uwf workflow add` in favor of workflowPaths.

## 0.5.0 — 2026-06-12

- Bundle 3 general-purpose example workflows (debate, brainstorm, socratic-questioning) into the CLI package. `uwf setup` now auto-registers them so users can run them immediately without manual `workflow add`.

  Add `$body` as an engine-injected Liquid template variable in edge prompts. `{{ $body }}` resolves to the markdown body (after frontmatter) from the previous step's output, enabling full prose to flow between roles instead of only frontmatter field summaries. Defining `$body` in a frontmatter schema is rejected by the validator as a reserved property.

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

- Migrate `examples/debate.yaml` from Handlebars triple-brace `{{{var}}}` syntax to Liquid `{{ var }}` syntax. The 0.4.0 LiquidJS-based validator rejected the old syntax with six `template variable "unknown" not found` errors. Fixes #300.
- Migrate remaining example workflows from Handlebars triple-brace `{{{var}}}` syntax to Liquid `{{ var }}` syntax. Updates `examples/e2e-walkthrough.yaml` (12 occurrences), `examples/normalize-bun-monorepo.yaml` (22 occurrences), and `examples/solve-issue.yaml` (11 occurrences). The 0.4.0 LiquidJS-based validator rejected the old syntax with `template variable "unknown" not found` errors. Fixes #307.
- Fix `formatOutput(data, "text")` returning `undefined` (issue #327).

  `OutputFormat` already included `"text"` per #320, but the legacy
  `formatOutput` helper still only exhaustively matched `"json" | "yaml"` —
  calling it with `"text"` fell through the switch and returned `undefined`.
  That bug was masked in production because the CLI's `writeRawOutput`
  narrowed the format down to `"json" | "yaml"` before calling
  `formatOutput`. Tests and library consumers that called `formatOutput`
  directly with `"text"` got the literal string `"undefined"` printed.

  Changes:

  - `formatOutput(data, format, commandPath?)` now accepts the full
    `OutputFormat` union (`text | json | yaml | raw-json | raw-yaml`) and
    always returns a `string`.
  - New `TEXT_RENDERERS` registry of type
    `Record<string, (data: unknown) => string>` provides per-command text
    renderers for `thread list`, `thread show`, `thread start`,
    `workflow list`, `workflow show`, `step list`, and `step show`. The
    rendererss tolerate missing/null fields and never return `undefined`.
  - `getTextRenderer(commandPath)` and `registerTextRenderer(commandPath, fn)`
    expose the registry for library consumers.
  - When `formatOutput` is called with `"text"` and no `commandPath` (or no
    matching renderer), it falls back to a pretty-printed JSON serialization
    rather than `undefined`.
  - `writeRawOutput` in the CLI was simplified to forward the active format
    directly to `formatOutput`, so `--format text` is consistently honored
    for the legacy raw-output commands (`thread cancel`, `step fork`,
    `setup`, `log`, `config`).

- fix(cli): render `thread cancel` output via the per-command text renderer

  `uwf thread cancel <thread-id>` previously produced raw JSON under the
  default `--format text` because the cancel `.action()` did not pass a
  `commandPath` to `writeRawOutput`, and `TEXT_RENDERERS` had no entry
  for `"thread cancel"`. This adds `renderThreadCancel` and registers it,
  matching the pattern introduced in #329 for the other CLI commands.
  JSON / YAML output is unchanged.

  Fixes #331

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

- fix(cli): route `thread stop` output through text renderer (#341)

  `uwf thread stop` was emitting raw JSON (`{"thread":"...","stopped":false}`)
  instead of a human-readable text view under the default `--format text`. This
  mirrors the gap previously fixed for `thread cancel` (#331) and `workflow add`
  (#334).

  - Added `renderThreadStop` to `packages/cli/src/text-renderers.ts`.
  - Registered `"thread stop"` in the `TEXT_RENDERERS` map in `format.ts`.
  - Updated `cli.ts` to pass `"thread stop"` as the `commandPath` to
    `writeRawOutput`, so `formatOutput` resolves the new renderer.

  JSON / YAML output formats are unchanged.

- fix(cli): route `log list` and `log show` output through text renderer (#342)

  `uwf log list` and `uwf log show` were emitting raw JSON arrays instead of a
  human-readable text view under the default `--format text`. This mirrors the
  gap previously fixed for `thread cancel` (#331), `workflow add` (#334), and
  `thread stop` (#341).

  - Added `renderLogList` and `renderLogShow` to
    `packages/cli/src/text-renderers.ts`.
  - Registered `"log list"` and `"log show"` in the `TEXT_RENDERERS` map in
    `format.ts`.
  - Updated `cli.ts` to pass `"log list"` / `"log show"` as the `commandPath`
    to `writeRawOutput`, so `formatOutput` resolves the new renderers.

  JSON / YAML output formats are unchanged.

- Fix `uwf thread list --format text` rendering year `58414-12-06` (issue #351). The `THREAD_LIST_TEMPLATE` in `packages/protocol/src/output-templates.ts` piped `item.startedAt` (Unix milliseconds, per `THREAD_LIST_OUTPUT_SCHEMA`) directly into LiquidJS's `| date` filter, which expects Unix seconds. The template now converts ms→s via `| divided_by: 1000` before `| date`, so `STARTED` cells render correctly (e.g. `2026-06-12 05:25`). Adds protocol-level regression-guard tests that reject any future template piping a ms-typed schema field (`startedAt`, `completedAt`, `startedAtMs`, `completedAtMs`, `timestamp`) into `| date` without prior conversion.
- fix: rename `$body` to `_body` for LiquidJS compatibility

  PR #262 replaced Mustache with LiquidJS but `$body` uses a `$` prefix which is
  invalid in Liquid template syntax. Rename the engine-injected variable from
  `$body` to `_body` so edge prompt templates work correctly.

  - `thread.ts`: inject `_body` instead of `$body`
  - `validate-semantic.ts`: remove `sanitizeReservedVars` workaround, add `_body` to mock data for strict validation
  - `workflow-authoring-reference.ts`: update docs to `_body`
  - `socratic-questioning.yaml`: update template references
  - `build-thread-progress`: add optional `threadId` parameter so agents can reference their own thread ID

- Fix thread list crash when workflow CAS node is missing or has wrong type

  Replace `fail()` (process.exit) with `throw new Error()` in `loadWorkflowPayload` so errors are catchable by the try/catch blocks in `collectActiveThreads` and `collectCompletedThreads`. Threads with missing or invalid workflow references now appear as `corrupt` instead of crashing the entire `uwf thread list` command.

- Fix test suite polluting global CAS store (~/.ocas/)

  - Add vitest `globalSetup` to detect `OCAS_HOME`/`UWF_HOME` env var leaks between test files
  - Centralize `makeUwfStore` helper into `thread-test-helpers.ts` (was copy-pasted in 10 files)
  - Add `OCAS_HOME` save/restore in `afterEach` for all 13 leaking test files
  - Add `afterEach` cleanup to `thread-cancel-status.test.ts` and `store-unified-threads.test.ts` (had none)

- Fix `uwf thread list` startedAt timestamp showing dates far in the future
  (e.g. year 2195 for threads created in 2026). The local `extractUlidTime`
  helper in `packages/cli/src/output-mappers.ts` manually decoded the first
  10 Crockford Base32 chars of a ULID as `n = n * 32 + v`, returning the
  raw 50-bit value without stripping the 2 padding bits introduced by
  `encodeCrockfordBase32Bits`. This produced timestamps 4× the real value.

  The helper has been removed in favor of `extractUlidTimestamp` from
  `@united-workforce/util`, which delegates to
  `decodeCrockfordBase32Bits(timestampPart, 48)` and handles padding
  correctly. A new unit test
  (`packages/cli/src/__tests__/output-mapper-thread-list-startedat.test.ts`)
  covers the round-trip across several timestamps and the
  malformed-ULID-null fallback.

  Fixes #343.

- Remove stale LLM provider/model references from bootstrap prompt and BOOTSTRAP.md. Engine config is now LLM-free — `uwf setup` only takes `--agent`. Config shows only `agents`, `defaultAgent`, `agentOverrides`.
- Add step-level concurrency control for `uwf thread exec`

  - New `concurrency/` module with file-based slot management (`acquireSlot`, `releaseSlot`, `countActiveSlots`, `cleanStaleSlots`, `installSlotCleanup`)
  - `concurrency.maxRunning` config key for persistent limit (`uwf config set concurrency.maxRunning <n>`)
  - Default limit: 2 concurrent agent processes (when no config provided)
  - Race protection via double-check-after-write with automatic rollback
  - Signal handlers (SIGINT/SIGTERM) release the slot on abnormal exit
  - Stale slot cleanup: detects dead PIDs and removes orphaned slot files

## 0.4.0 — 2026-06-11

- docs: rewrite `adapter-developing` prompt for v0.4 contract (#214)

  `generateAdapterDevelopingReference()` was multiple versions behind. Rewrite covers:

  - `AgentOptions.fork: AgentForkFn | null` and `AgentOptions.cleanup: AgentCleanupFn | null`
  - complete public helpers table including `buildSuspendOutput`, `buildFrontmatterRetryPrompt`, `buildThreadProgress`, `getCachedSessionId`/`setCachedSessionId`, `getAskSessionId`/`setAskSessionId`
  - `$SUSPEND` coroutine yield (`buildSuspendOutput`, `trySuspendFastPath`, engine intercepts before the moderator)
  - `step ask` adapter contract (`--mode fork --session ...`, `--mode ask --session ... --prompt ...`)
  - adapter-owned LLM config at `~/.uwf/agents/<name>.yaml` (engine config is LLM-free)
  - failed-step retry path (`$status: error`, `previousAttempts`, `@uwf/thread-failed/`, head not advanced on `isError`)
  - `AgentRunResult` with all 5 fields and `Usage` shape
  - realistic `run()` skeleton replacing the empty placeholder
  - `isFirstVisit` semantics and re-entry pattern
  - "fast path" jargon replaced with "frontmatter extraction" / "suspend interception" before the symbol names appear
  - removed undefined `textSchema`/`detailSchema` references; show `registerAgentSchemas`/`schemas.text` real APIs
  - `AdapterOutput` JSON-stdout envelope, `storageRoot`/`casDir`, `UWF_HOME`/`OCAS_HOME` propagation

  Adds 36 targeted assertions in `packages/cli/src/__tests__/prompt.test.ts` covering every issue item.

- docs: document edge `location` field and cross-cwd workflow execution (#226)

  `generateWorkflowAuthoringReference()` previously documented graph edges as `{ role, prompt }` only and had no example demonstrating per-step working directory overrides. Adds to the `## Graph Routing` section:

  - **Cross-cwd Execution** subsection explaining the cwd inheritance chain: `--cwd` flag → `StartNodePayload.cwd` → `Target.location` override → `StepRecord.cwd`
  - **Edge Target Fields** table covering `role`, `prompt`, and the new `location` field (optional, Mustache-rendered, falls back to the thread's start cwd when `null` or omitted)
  - A realistic cross-repo dispatch YAML example where a `cloner` role outputs `repoPath` and the downstream `developer` edge uses `location: "{{{repoPath}}}"` to run inside the freshly cloned working directory

  Adds 10 assertions in `packages/cli/src/__tests__/prompt.test.ts` covering field documentation, the inheritance chain (in order), Mustache template support, a realistic cross-cwd YAML example, and structural placement under `## Graph Routing`.

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

- fix(cli): align `uwf workflow list` with `uwf thread start` parent traversal; document `.workflow/` auto-discovery (#162)

  `discoverProjectWorkflows()` now walks from `cwd` up through parent directories
  looking for the nearest `.workflow/` (or legacy `.workflows/`), mirroring
  `findWorkflowInParents()` used by `uwf thread start`. Previously, `uwf workflow
list` only inspected the exact `cwd` and returned `[]` when run from any
  subdirectory, even though `uwf thread start <name>` succeeded from the same
  location. The two commands now agree on what is discoverable.

  The `@united-workforce/util` reference strings (`generateUsageReference`,
  `generateCliReference`, `generateWorkflowAuthoringReference`) are updated to
  document project-local `.workflow/` auto-discovery and recommend it as the
  primary placement strategy — `uwf workflow add` registration is only needed for
  global, cwd-independent workflows.

- chore(cli): remove unused `_workflowRef` ghost parameter from `resolveActiveThreadStatus`

  `resolveActiveThreadStatus` in `packages/cli/src/commands/thread.ts` accepted a
  `_workflowRef` argument that was never read inside the body — it only resolves
  status from the running marker and the chain reachable from `head`. The dead
  parameter (and the matching argument at the three call sites in `cmdThreadShow`,
  the thread-list helper, and `cmdThreadResume`) has been dropped. No behavior
  change.

- fix(cli): swap `.workflow/` vs `.workflows/` primary/legacy semantics (#187)

  `.workflows/` (plural) is now the primary auto-discovery directory and
  `.workflow/` (singular) is the legacy fallback. When both exist in the same
  directory, `.workflows/` entries win on name collisions. Projects using only
  `.workflow/` continue to work without changes — discovery falls back to it
  when `.workflows/` is absent.

  The `@united-workforce/util` reference strings (`generateUsageReference`,
  `generateCliReference`, `generateWorkflowAuthoringReference`) are updated to
  recommend `.workflows/` as the primary placement strategy and document
  `.workflow/` as a legacy fallback.

- feat(cli): add `uwf workflow validate <file>` subcommand (#195)

  New CI-friendly subcommand that validates a workflow YAML file without
  registering it in CAS or the workflow registry. Catches schema/semantic
  mismatches (such as graph prompts referencing fields missing from a role's
  frontmatter) before runtime.

  - Parses YAML, runs the same `parseWorkflowPayload` shape check, the
    filename↔name consistency check, and `validateWorkflow` semantic checks
    used by `workflow add`.
  - On success: silent (empty stdout, empty stderr, exit 0).
  - On failure: writes a single error message to stderr and exits 1.
  - Does not touch CAS, the workflow registry, or any disk state under
    `OCAS_HOME` / `UWF_HOME` — safe to run in a read-only CI sandbox.
  - Resolves `!include` tags relative to the YAML file's directory, matching
    `workflow add` semantics.

  The `@united-workforce/util` reference strings (`generateUsageReference`,
  `generateCliReference`) are updated to document the new command.

- Replace Mustache template engine with LiquidJS for edge prompt and location rendering.

  - Swap `mustache` dependency for `liquidjs` in cli package
  - Rewrite moderator `evaluate()` to use `Liquid.parseAndRenderSync()`
  - Rewrite validator to use LiquidJS strict-render instead of regex extraction
  - Migrate all `.workflows/*.yaml` from `{{{var}}}` to `{{ var }}` syntax
  - Update workflow authoring reference documentation

- Update documentation and type annotations from Mustache to Liquid terminology (Phase 2 of LiquidJS migration)
- Fix outdated command names in `uwf setup` output and correct misleading help text about LLM config location.
- Refactor to reduce cognitive complexity in spawnAgent and createAgent main functions. Extract helper functions to pass Biome's noExcessiveCognitiveComplexity check (limit 15). Fix array formatting in thread status filter.
- fix(cli): prevent PID recycling from permanently sticking threads in 'running' state

  When a uwf process is killed with SIGKILL and a new unrelated process inherits
  the same PID, threads would appear permanently stuck in 'running' state. Now the
  running marker records `processStartTime` from `/proc/<pid>/stat` (field 22) and
  all marker validation checks (exec, list, stop, cancel) verify both PID aliveness
  AND process identity. Stale markers from recycled PIDs are automatically cleaned
  up. On non-Linux systems, `processStartTime` is null and the behavior gracefully
  falls back to PID-alive-only checks. Fixes #288.

- fix: stop parent traversal at .git boundary

  `findWorkflowInParents()` and `discoverProjectWorkflows()` now stop traversing
  parent directories when they encounter a `.git` directory or file (git worktree).
  This prevents picking up unrelated `.workflow/` directories above the repository
  root in monorepo setups.

- Add `workflowName` field to `thread list` output. Each thread now includes a resolved workflow name from the registry, or `null` when the workflow hash is not in the registry (orphaned thread). Fixes #286.
- docs: update built-in prompts for v0.4.0

  - bootstrap: add `thread resume`/`thread poke` verification, v0.3→v0.4 migration notes (`completed`→`end`, `$SUSPEND` mechanism)
  - usage: document `thread resume`, `thread poke`, `config` subcommands, `$SUSPEND` usage, `workflow validate` placeholder
  - workflow-authoring: add `$SUSPEND` design guide (`SuspendOutput` type, guidelines, example), validation section

- refactor: rename ThreadStatus "completed" → "end" (#186)

  **Breaking:** `ThreadStatus` no longer includes `"completed"`. The terminal status for threads that reach `$END` is now `"end"`.

  - `ThreadStatus` union: `"idle" | "running" | "suspended" | "end" | "cancelled"`
  - `completeThread()` and `markThreadCompleted()` now accept `"end" | "cancelled"` (was `"completed" | "cancelled"`)
  - `--status completed` CLI filter is replaced by `--status end`
  - Legacy on-disk data with `status: "completed"` is silently normalized to `"end"` on read

  **Why:** `$END` is a neutral terminal state — success, failure, or guard-blocked all route there. "completed" misleadingly implies success. "end" is neutral and matches the `$END` pseudo-role name.

- feat(cli): add `uwf step ask <step-hash> -p <prompt>` read-only follow-up command

  Phase 2b of the ask-session work. Adds a new subcommand that lets the user ask
  a follow-up question to a historical step's agent without writing a new
  `StepNode` or mutating thread state. The command resolves the agent from the
  recorded step (or `--agent <cmd>` override), forks the original session via the
  adapter's `--mode fork --session <source>` contract, caches the resulting
  ask-session id under `<stepHash>:ask` so subsequent asks reuse it, then invokes
  the agent with `--mode ask --session <forkId> --prompt <text> --detail <ref>`
  and streams the raw stdout to the caller. `--no-fork` falls back to a fresh
  session that receives the step's detail ref for context. The `prompt usage`
  reference (in `@united-workforce/util`) is also updated so agents discover the
  new subcommand. Resolves issue #146.

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

- feat(cli): `uwf thread list` now defaults to active threads only

  Changes the default behavior of `uwf thread list` to show only active threads
  (idle + running). Adds a new `--all` flag to opt into the previous behavior of
  listing every thread (including completed, cancelled, and suspended).

  When invoked with no flags, the command now hides completed/cancelled/suspended
  threads. Use `--all` to see them, or `--status <status>` to filter explicitly.
  The `--status` filter wins when both are present. Resolves issue #147.

- feat(cli): add `uwf thread poke` command

  New subcommand `uwf thread poke <thread-id> -p <prompt>` re-runs the head step's
  agent with a supplementary prompt, replacing the head step's output. Unlike
  `thread resume`, poke skips the moderator and rewrites the new step's `prev`
  pointer so the new head replaces (not appends to) the old head. Works on idle
  and suspended threads. Resolves issue #144 (Phase 1).

- Fix `uwf workflow show` to resolve local project workflows from `.workflows/` directory using parent traversal, matching the behavior of `uwf thread start`. Previously, `workflow show` only resolved workflows from the global registry or direct CAS hashes, making it impossible to inspect local project workflows without first registering them globally via `uwf workflow add`.

  The command now follows the full 4-strategy resolution order:

  1. **CAS hash** — direct CAS load for 13-char Crockford Base32 hashes
  2. **File path** — materialize from explicit `.yaml`/`.yml` paths (relative or absolute)
  3. **Local discovery** — traverse upward from cwd to find `.workflows/<name>` (or legacy `.workflow/<name>`)
  4. **Global registry** — fallback to `@uwf/registry/*` variables

  This aligns `workflow show` with `thread start` and `workflow list`, ensuring consistent workflow resolution across all CLI commands.

- Add `version` field to workflow YAML format. `WorkflowPayload` now includes a top-level `version: number` (integer). Legacy YAML without `version` falls back to `1`; `uwf workflow add` warns when the field is missing. All in-repo workflow YAML files updated to `version: 1`. Fixes #294.

## 0.1.1

### Patch Changes

- 850a3b2: fix: resolve --agent override via config alias before raw command

  `resolveAgentConfig()` now checks `config.agents[alias]` first before falling back to `parseAgentOverride()`. Eval CLI default `--agent` changed from `"hermes"` to `"uwf-hermes"`.
