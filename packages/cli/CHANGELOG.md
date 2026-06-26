# @united-workforce/cli

## 0.8.0 — 2026-06-26

- fix(cli): step show now includes StepNode metadata (role, agent, timing, usage)
  
  `step show` previously returned only the expanded detail node (broker-detail),
  which lacks StepNode metadata. Now returns a merged object with `hash`, `role`,
  `agent`, `status`, `startedAtMs`, `completedAtMs`, `durationMs`, `usage`, and
  `detail` (the expanded broker-detail). The `frontmatter` and `turns` fields
  remain accessible under the `detail` key.
  
  Fixes #392
- feat(cli): realtime per-turn accumulation + step-completion solidification (#398)
  
  RFC 实时 turn 持久化的 Phase 2（本体）。broker-step 在 `broker.send` 时传入
  `onTurn` 回调，把每个 assistant turn 实时持久化进 OCAS——既能跨进程查到运行中
  step 的中间 turn，step 完成后再固化进不可变 step detail。
  
  - broker-step 调 `broker.send({onTurn})`，回调里：(a) `store.cas.put(TURN_SCHEMA,
    {role,content})` → turnHash；(b) append turnHash 到 active var
    `@uwf/active-turns/<threadId>/<role>`（读-改-写数组）
  - step 开始先清空该 active var——crash 重跑是新 attempt，旧 turn 属于失败 attempt，
    不接续 append
  - step 完成时 `storeBrokerDetail` 读 active var 全量 turnHash 列表写进 `detail.turns`，
    然后删除 active var；`detail.turnCount = turns.length`（不再恒为 1）
  - store.ts 新增 active-turns var 读写 API（`appendActiveTurn` / `readActiveTurns` /
    `clearActiveTurns` / `activeTurnsVarName` / `ACTIVE_TURNS_VAR_PREFIX`）
  
  依赖 Phase 1（#397，broker `onTurn` / `SendResult.turns`）。
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
- Phase 3: Rewrite `buildTurnsPanorama` to use owner-based segmentation (#421)
  
  This completes the Turn Chain RFC Phase 3, root-causing #412 (recurring role in-flight
  mis-attribution). The `uwf step turns` panorama now:
  
  - Walks the step-start chain via turn `owner` field instead of role-keyed vars
  - Sources each segment's turns via `turnsOfStep(turnHead, stepStartHash)`
  - Detects in-flight steps by matching `active-step` var to step-start hash
  - Reads `edgePrompt` directly from step-start nodes
  
  Key behavioral changes:
  - Same role running multiple rounds now correctly shows separate segments
  - In-flight detection no longer relies on role name (which was ambiguous for recurring roles)
  - `--live` mode now polls `active-turn-head` instead of role-keyed active vars
  - Legacy threads (without Phase 3 turn chain) still work via fallback path
  
  Closes #412, #421.
- Add CLI subprocess integration test for `uwf step turns` command with recurring role scenario (#423)
- fix(broker-step): correct illegal Crockford log tag that crashed on frontmatter-extraction failure (#426)
  
  `PL_FRONTMATTER_FAIL` was `"F4FA1L7Z"` — a leet spelling of "FRONTMATTER FAIL"
  that smuggled an `L` into the tag. Crockford Base32 excludes I/L/O/U, so
  `assertValidLogTag()` throws on it. The tag is only used on the
  frontmatter-extraction-failure path (after retries are exhausted), so it stayed
  dormant until a planner step genuinely failed extraction — at which point the
  failure *logger itself* crashed the `uwf thread exec` process, masking the real
  error and leaving the thread stuck.
  
  - Fix the tag: `F4FA1L7Z` → `F4FA117Z` (all-valid Crockford).
  - Add a static regression guard (`log-tag-validity.test.ts`) that scans the cli
    + broker package sources and asserts every `log("…")` literal and `PL_*` tag
    constant is valid Crockford Base32 — turning this whole class of bug from a
    runtime crash into a build-time failure.
- feat(broker): recognize sumeru `event: suspend` and wire timeout → suspend → resume (#435)
  
  RFC #95 Phase 2. A sumeru send that hits its timeout now emits a terminal
  SSE `suspend` frame instead of `done`. The broker recognizes it, the CLI
  parks the thread on the existing `$SUSPEND` exit, and `uwf thread resume`
  continues the run by `nativeId` — no new thread status and no new command.
  
  **`@united-workforce/broker`**
  
  - `sumeru-client`: `consumeSse` now handles `event: suspend`. A new
    `parseSuspendEvent` validates the `@sumeru/suspend` envelope
    (`{ reason: "timeout", nativeId, elapsedMs }`), mirroring `parseErrorEvent`;
    malformed JSON or a missing envelope surface a descriptive stream error.
    Suspend is terminal — a trailing `done` is ignored.
  - New exported type `SumeruSuspendValue = Readonly<{ reason: "timeout";
    nativeId: string; elapsedMs: number }>`.
  - `SumeruSendOutcome` is now a discriminated union on `kind`
    (`"completed" | "suspended"`); `output`/`done`/`assistantTurnCount` live
    only on the completed branch.
  - **Breaking (pre-1.0):** `SendResult` is likewise a discriminated union —
    `kind:"completed"` carries `output` + required `done`; `kind:"suspended"`
    carries `reason`/`nativeId`/`elapsedMs` and no `done`. Consumers must
    narrow `result.kind === "completed"` before reading `output`/`done`, so
    "suspended ⇒ no done" holds at the type level.
  
  **`@united-workforce/cli`**
  
  - `executeBrokerStep`: when `broker.send()` returns `kind:"suspended"`
    (including inside the frontmatter-retry loop), route into the existing
    `$SUSPEND` machinery via a module-private `buildSuspendOutput` +
    the public `trySuspendFastPath` rather than the error path. The thread
    enters `suspended` (a human gate), is never retried, and records
    `nativeId`/`elapsedMs`/`reason` on the detail node for diagnostics. The
    completed path is unchanged.
  
  The `$SUSPEND` wire format is a one-liner over `SUSPEND_STATUS`, kept private
  in `broker-step.ts`: the #381 public-API cleanup deliberately keeps the
  adapter-side `buildSuspendOutput` out of the `@united-workforce/util-agent`
  barrel, and the broker step is engine/CLI code, not an adapter.
  
  The resume loop is verified, not modified: `uwf thread resume` already
  accepts `suspended` and issues a fresh `broker.send()` on the same mapped
  `(threadId, role)` session, so the sumeru adapter resumes from its own
  history by `nativeId`.
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
- docs: document timeout-as-suspend in the Suspend / Resume section (RFC #95 Phase 3)
  
  The CLI README's Suspend / Resume section only covered *voluntary* suspend (an
  agent emitting `$status: "$SUSPEND"`). Phase 2 (#435) added a second source —
  **timeout-as-suspend**: when a `send` exceeds the adapter timeout the broker now
  yields a `kind: "suspended"` result that lands at the same `$SUSPEND` exit, so a
  timeout becomes a recoverable checkpoint instead of a fatal error.
  
  - Document both suspend sources (voluntary + timeout checkpoint) and how `resume`
    issues a fresh `send` that reuses the cached session / native `--resume <id>`.
  - Add the previously-missing `resume` and `poke` thread commands to the top-level
    README command table.
  
  Docs only — no behavior change.
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
- Migrate CLI from commander to @ocas/cli-kit createCLI() builder.
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

## 0.7.0

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

- bd25399: fix(cli): assemble the full agent prompt before `broker.send()` (#387)

  The broker path (`executeBrokerStep`) previously sent only the bare moderator
  edge prompt (a short graph-edge sentence) to `broker.send()`, dropping the rich
  context the legacy spawned-agent path assembled. Agents therefore lacked their
  role definition, output-format instruction, and thread history.

  `executeBrokerStep` now assembles the same five-part prompt the legacy
  `buildClaudeCodePrompt` produced before sending it to the broker:

  1. output-format instruction — derived from the role's frontmatter schema
  2. thread progress — step count and role visit count
  3. role prompt — Goal / Capabilities / Prepare / Procedure / Output sections
  4. task prompt — the thread's initial user prompt
  5. continuation context — steps since the last visit (re-entry) or the edge
     prompt (first visit), with recent step content on a first visit that already
     has history

  The fully assembled prompt is also persisted as a CAS text node on the
  `StepNode` (`assembledPrompt`), so `uwf step read --prompt` surfaces exactly
  what was sent. This reuses the existing `buildRolePrompt`,
  `buildOutputFormatInstruction`, `buildThreadProgress`, and
  `buildContinuationPrompt` helpers from `@united-workforce/util-agent`.

- Updated dependencies [aeb2449]
- Updated dependencies [2da4a1a]
  - @united-workforce/protocol@0.4.0
  - @united-workforce/util-agent@0.3.0
  - @united-workforce/util@0.2.1
  - @united-workforce/broker@0.2.0

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
