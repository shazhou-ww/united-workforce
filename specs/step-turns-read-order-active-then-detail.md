---
scenario: "uwf step turns <thread-id> reads the running step's turns from the @uwf/active-turns var first and falls back to the completed step's immutable detail.turns once the var is gone; both render the same turns via the reused step-read markdown pipeline"
feature: step
tags: [cli, step-turns, turns, active-var, detail, read-order, render-reuse, phase4, "400"]
---

## Given
- Phase 4 of the realtime-turns RFC (`docs/rfc-realtime-turns.md`, "Phase 4: CLI `uwf step turns
  --live` 消费端"). Depends on the already-merged Phase 2 (#398) which provides the active-turns
  var API in `packages/cli/src/store.ts`:
  - `ACTIVE_TURNS_VAR_PREFIX = "@uwf/active-turns/"` and
    `activeTurnsVarName(threadId, role) = "@uwf/active-turns/<threadId>/<role>"`.
  - `readActiveTurns(store, threadId, role): CasRef[]` — resolves the var → its array node →
    the ordered `CasRef[]` of turn hashes; returns `[]` when the var is absent (no turns appended
    yet, or already solidified/cleared).
  - On step completion `storeBrokerDetail` solidifies that same ordered list into the immutable
    `detail.turns` (`detail.turnCount === detail.turns.length`) and **deletes** the active var
    (`cli-broker-step-solidify-detail-turns.md`).
- The turn nodes are the pure `{ role: "assistant", content }` shape (`TURN_SCHEMA`), identical
  whether referenced from the active var or from `detail.turns` (RFC appendix A: turn nodes stay
  pure content; linkage lives in the var / detail array).
- Single-package change: `@united-workforce/cli` only — a new `uwf step turns` subcommand wired in
  `packages/cli/src/cli.ts` and a `cmdStepTurns` in `packages/cli/src/commands/step.ts`. No broker,
  protocol, or Sumeru changes.
- The command's positional argument is a **`<thread-id>`** (a `ThreadId`), NOT a `<step-hash>` like
  `step read` / `step show`. This is deliberate: the in-flight turn list is keyed by
  `(threadId, role)` in the active var, so the running step has no settled StepNode hash to address.
- Reuse anchor — the existing `step read` renderer in `packages/cli/src/commands/step.ts`:
  `loadTurnData(store, turns: CasRef[]) → TurnData[]` (via `parseSingleTurn`), then
  `formatTurnBody(turn)` and the `## Turn N` block assembly in `formatStepMarkdown`. Both the active
  var and `detail.turns` are a `CasRef[]` of `{role, content}` turn nodes — exactly the input
  `loadTurnData` already consumes — so Phase 4 renders turns through **the same** helpers rather
  than a parallel renderer.
- A thread `06FCY...` whose currently-running (or just-completed) step has produced exactly 3
  assistant turns `["t1","t2","t3"]` for role `coder`.

## When
- **Running case** — while the step is still in flight (active var present), the user runs:
  ```bash
  uwf step turns 06FCY... --role coder
  ```
- **Completed case** — after the step completes (active var deleted, turns solidified into
  `detail.turns`), the user runs the same command again:
  ```bash
  uwf step turns 06FCY... --role coder
  ```
- Unit test (issue #400, Step 1) — drives `cmdStepTurns(storageRoot, threadId, { role: "coder",
  live: false })` against a store seeded two ways for the **same** 3 turn hashes: (a) an
  `@uwf/active-turns/<tid>/coder` var pointing at `[h(t1),h(t2),h(t3)]`, and (b) the var removed +
  a head StepNode whose `detail.turns === [h(t1),h(t2),h(t3)]`.

## Then
- **Read order** — `cmdStepTurns` resolves the turn-hash list with active-var precedence:
  1. `const active = readActiveTurns(uwf.store, threadId, role)`. If `active.length > 0`, those are
     the turns to render (the in-flight step).
  2. Otherwise (active var absent/empty) it falls back to the **completed** step: resolve the
     thread head StepNode (via the thread var, as `resolveHeadHash` does), and use its `detail.turns`
     **only when the head StepNode's `role === role`** (`readHeadDetailTurns` is role-aware); on a
     role mismatch it yields `[]` rather than the head step's turns (see `step-turns-role-selection.md`).
- **Running case output** lists all turns produced so far (here all 3), each rendered through the
  reused `loadTurnData` + `formatTurnBody` pipeline: a `## Turn N` header followed by
  `**Turn role:** assistant` and the turn `content`, in arrival order (`t1`, `t2`, `t3`).
- **Completed case output** renders the **same 3 turns** from `detail.turns` with **byte-identical
  per-turn blocks** — because the solidified `detail.turns` equals the active var's contents
  captured at completion (`cli-broker-step-solidify-detail-turns.md`) and the **same** renderer is
  used. Read-order is transparent to the user: the turn blocks for `06FCY... --role coder` are the
  same before and after completion.
- Each rendered turn's `content` matches the stored turn node's `content` exactly (no trimming /
  re-parse), and each turn hash in the resolved list is gettable in CAS as a
  `{ role: "assistant", content }` node.
- Empty / edge handling (graceful, no crash):
  - No active var **and** head is a StartNode (thread has no steps yet) → an empty turn list is
    rendered (header only, e.g. `# Thread 06FCY... (role: coder)` with no `## Turn` blocks), exit 0.
  - No active var **and** head StepNode has `detail === null` or `detail.turns === []` → same
    empty-list rendering, exit 0.
  - No active var **and** the head StepNode's `role !== ` the queried role → empty-list rendering,
    exit 0. The detail fallback (`readHeadDetailTurns`) is **role-aware**: it returns the head step's
    `detail.turns` only when `headStepNode.role === role`, else `[]`. So on a completed multi-role
    thread (e.g. `planner → coder`, head = coder step) `--role planner` / `--role reviewer` do **not**
    inherit the coder head step's turns — they render empty. (Role selection is specified in
    `step-turns-role-selection.md`; called out here because it is part of the same
    active-var-precedence → detail-fallback resolution and shares the `readHeadDetailTurns` helper.)
  - Unknown thread → fails with the existing `thread not found: <id>` message (matching
    `resolveHeadHash`), exit non-zero.

## Notes
- The headline guarantee is **read-order consistency**: the same `(threadId, role)` yields the same
  ordered turn content whether sourced from the live active var or the frozen `detail.turns`. The
  top-level header line MAY differ (running has no StepNode hash, so it can read e.g.
  `# Thread <tid> (role: coder)` while the completed/`step read` path reads `# Step <stepHash>`);
  the asserted equality is over the **per-turn `## Turn N` blocks**, which are hash/role-agnostic.
- Because it reuses `loadTurnData`/`formatTurnBody`, `step turns` inherits their forward-compatible
  shape handling: turns render from `{role, content}` and tolerate extra fields (`index`,
  `toolCalls`) if a future producer writes them — see the `step-commands` card.
- `--quota` MAY be accepted with the same default and newest-first back-fill behavior as
  `step read` (it shares `selectTurnsForQuota`); the headline assertions here are read-order and
  render-equivalence, not quota math, which is covered by `step-read.test.ts`.
- The cross-process visibility of the active var that makes the running-case read possible is the
  Phase 2 guarantee (`cli-broker-step-cross-process-visibility.md`); Phase 4 only adds the ergonomic
  consumer command over that SQLite-backed var.
