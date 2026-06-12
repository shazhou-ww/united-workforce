# Changelog

## 0.2.0 — 2026-06-12

- Bundle 3 general-purpose example workflows (debate, brainstorm, socratic-questioning) into the CLI package. `uwf setup` now auto-registers them so users can run them immediately without manual `workflow add`.
  
  Add `$body` as an engine-injected Liquid template variable in edge prompts. `{{ $body }}` resolves to the markdown body (after frontmatter) from the previous step's output, enabling full prose to flow between roles instead of only frontmatter field summaries. Defining `$body` in a frontmatter schema is rejected by the validator as a reserved property.
- fix: rename `$body` to `_body` for LiquidJS compatibility
  
  PR #262 replaced Mustache with LiquidJS but `$body` uses a `$` prefix which is
  invalid in Liquid template syntax. Rename the engine-injected variable from
  `$body` to `_body` so edge prompt templates work correctly.
  
  - `thread.ts`: inject `_body` instead of `$body`
  - `validate-semantic.ts`: remove `sanitizeReservedVars` workaround, add `_body` to mock data for strict validation
  - `workflow-authoring-reference.ts`: update docs to `_body`
  - `socratic-questioning.yaml`: update template references
  - `build-thread-progress`: add optional `threadId` parameter so agents can reference their own thread ID

## 0.1.5 — 2026-06-11

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
- docs: fix workflow-authoring guide oneOf documentation (#244)
  
  The "Frontmatter Schema" section incorrectly stated that `type: object` is **required**
  at the top level of frontmatter for both flat and `oneOf` schemas. This contradicts
  the runtime: `collectObjectSchemas` in `build-output-format-instruction.ts` never
  inspects `type`; it only follows `properties` / `oneOf` / `anyOf`. A sibling
  `type: object` next to `oneOf` creates an unnecessary implicit conjunction.
  
  Changes:
  
  - The "Multi-exit (oneOf)" example no longer shows a sibling `type: object`.
  - The workflow-structure example's planner role schema is corrected the same way.
  - The "Important rules" bullet now distinguishes flat vs. `oneOf` schemas:
    flat schemas keep `type: object`; `oneOf` schemas must NOT have a sibling
    `type: object` and let each variant declare its own `properties`/`required`.
  
  Adds `packages/util/__tests__/workflow-authoring-reference.test.ts` with 11
  assertions guarding the corrected guidance and the unchanged flat examples.
- Replace Mustache template engine with LiquidJS for edge prompt and location rendering.
  
  - Swap `mustache` dependency for `liquidjs` in cli package
  - Rewrite moderator `evaluate()` to use `Liquid.parseAndRenderSync()`
  - Rewrite validator to use LiquidJS strict-render instead of regex extraction
  - Migrate all `.workflows/*.yaml` from `{{{var}}}` to `{{ var }}` syntax
  - Update workflow authoring reference documentation
- Update documentation and type annotations from Mustache to Liquid terminology (Phase 2 of LiquidJS migration)
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
- feat(cli): `uwf thread list` now defaults to active threads only
  
  Changes the default behavior of `uwf thread list` to show only active threads
  (idle + running). Adds a new `--all` flag to opt into the previous behavior of
  listing every thread (including completed, cancelled, and suspended).
  
  When invoked with no flags, the command now hides completed/cancelled/suspended
  threads. Use `--all` to see them, or `--status <status>` to filter explicitly.
  The `--status` filter wins when both are present. Resolves issue #147.

