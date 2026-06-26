# Changelog

## 0.3.0 — 2026-06-26

- feat(cli): `uwf step turns <thread-id> [--role <r>] [--live]` consumer command (#400)
  
  RFC 实时 turn 持久化的 Phase 4（消费端）。新增 `uwf step turns` 子命令，在 turn 层
  （layer 4）提供查询能力，依赖 Phase 2（#398）落地的 active-turns var API 与 step
  完成时固化的不可变 `detail.turns`。
  
  - 读取顺序：active var 优先（运行中 step 的实时 turn 列表
    `@uwf/active-turns/<threadId>/<role>`）→ 回退到 thread head StepNode 的不可变
    `detail.turns`（step 已完成）。两个来源都是 `{role, content}` turn 节点的
    `CasRef[]`，因此复用 `step read` 的渲染管线（`loadTurnData` → `formatTurnBody`），
    per-turn 块逐字节一致。
  - `--role` 选择 `(threadId, role)` var；并发角色互不干扰（exact-name 匹配）。省略时
    默认取 head step 的角色，让 `uwf step turns <tid>` 对单角色在途线程“做显然的事”。
  - `--live` 轮询 SQLite-backed active var（非 SSE），每个新 turn 仅打印一次（按已发出
    块数渲染增量尾部），step 完成（active var 被固化删除且 thread 不再 running）时退出 0；
    退出前对账 `detail.turns`，保证 active→detail 交接期间不丢 turn。
  - 完成态 `detail.turns` 回退是 **role-aware** 的：仅当 thread head StepNode 的
    `role === ` 查询角色时才用其 `detail.turns`，否则返回 `[]`。多角色线程
    （如 `planner → coder`，head 为 coder step）查 `--role planner` / `--role reviewer`
    不再续吐 coder head step 的 turns；`--live` 多 step run（`exec --count N≥2`）退出对账
    走同一 role-aware helper，`--live --role coder` follower 永不把最终 step（如 reviewer）
    的 turns 当作 coder turns 续吐。
  - README / cli README / `skill cli` / `prompt usage` 参考文档更新，说明 turn 层查询能力。
  
  `@united-workforce/cli`：minor — 新增 `uwf step turns --live` 消费命令。
  `@united-workforce/util`：patch — 重新生成的 CLI/usage 参考文本
  （`cli-reference.ts`、`usage-reference.ts`）现包含 `uwf step turns` 条目，随 util release 发布。
  只读命令，不改 broker / protocol / Sumeru。
- fix(cli): `uwf step turns` renders the whole-thread turn panorama + `--limit`/`--offset` (#409)
  
  `uwf step turns <thread-id>` 由「只读 thread head 那个 step 的 turns」改为
  「thread 到目前为止所有 turn 的全景」。底层根因修复：旧实现经
  `resolveTurnHashes → readHeadDetailTurns(uwf, head, role)` 只读 head step 的
  `detail.turns`，多 step thread（head 为某个角色，如 committer）下查
  `--role developer` 因 head-role≠developer 返回空（#408 修 role 隔离的副作用）。
  
  新语义沿整条 chain 遍历每个 step（复用 `cmdStepList` 已有的 `walkChain` +
  `collectOrderedSteps`，不重造），逐 turn 标注 role/step：
  
  - 已完成 step 读各自固化的不可变 `detail.turns`，step 级标记 `✓`；
  - 进行中 step 读 `@uwf/active-turns/<tid>/<role>` var，step 级标记 `🔄 进行中`；
  - per-turn 块复用 `step read` 的 `loadTurnData → formatTurnBody` 管线，逐字节一致；
  - **默认全量不截断**（复用 OCAS `ListOptions`「limit: undefined = 无限制」约定），
    新增 `--limit <n>` / `--offset <m>` 在展平的跨 step turn 序列上分页；
  - `--role <r>` 改为「沿全 chain 过滤该角色的 step」，先过滤再分页；同角色多 step 聚合；
  - `--live` 跟住进行中 step、增量去重打印，退出对账按 **followed role 的 chain step**
    作用域（多 step run 下永不把后续角色的 turns 当作被跟随 step 的续吐）。
  
  role 隔离问题随之结构性消失——turns 始终按其所属 step/role 取源，head-only 的
  `readHeadDetailTurns` role-guard hack（#408）不再需要，已移除。
  
  `@united-workforce/cli`: minor — `step turns` 全景语义 + `--limit`/`--offset`
  （向后兼容的命令面新增）。
  `@united-workforce/util`: patch — 重新生成的 CLI/usage 参考文本
  （`cli-reference.ts`、`usage-reference.ts`）现含 `--limit`/`--offset` 与全景说明。
  
  Closes #409.
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
- feat(thread-list): add `--limit`/`--offset` pagination to `uwf thread list` (#451)
  
  `uwf thread list` now accepts the canonical repo-wide `ListOptions` vocabulary
  `--limit <n>` / `--offset <m>`, matching `uwf step turns`. Previously passing
  `--limit` errored with `unknown option`, leaving no way to cap output when many
  threads exist.
  
  - `--limit N` → return at most the N newest threads (maps to the existing
    `take` parameter).
  - `--offset M` → skip the M newest threads (maps to the existing `skip`
    parameter); combined, they slice `[M, M+N)` over the newest-first list, after
    status/time filtering and the newest-first sort.
  - The pre-existing `--skip`/`--take` flags are retained as backward-compatible
    aliases. When both a canonical flag and its alias are supplied, the canonical
    `--limit`/`--offset` wins.
  - Validation reuses the same non-negative-integer rule (and flag-named error)
    as `step turns`; `--limit 0` yields no items while an absent `--limit` means
    all items.
  
  `@united-workforce/util`: regenerated the `thread list` block in the usage /
  CLI reference text to list `--limit`/`--offset`.
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

## 0.2.1

### Patch Changes

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
