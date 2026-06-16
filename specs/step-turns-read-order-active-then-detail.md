---
scenario: "Within the chain panorama, each step's turns are sourced per-step: a completed step from its immutable detail.turns, the in-flight step from its @uwf/active-turns var; both render via the same step-read pipeline, and the active→detail handoff loses no turn"
feature: step
tags: [cli, step-turns, turns, active-var, detail, read-order, render-reuse, chain, "409", "400"]
---

## Given
- Issue #409 redefines `uwf step turns <thread-id>` as a whole-chain panorama
  (`step-turns-chain-panorama.md`). The active-var-first / `detail.turns`
  fallback read-order is now applied **per step**, not once for the thread head.
- Active-turns var API (#398, `packages/cli/src/store.ts`):
  - `activeTurnsVarName(threadId, role) = "@uwf/active-turns/<threadId>/<role>"`;
  - `readActiveTurns(store, threadId, role): CasRef[]` — the in-flight step's
    live ordered turn-hash list; `[]` when absent (not started, or already
    solidified+cleared).
  - On step completion `storeBrokerDetail` solidifies that same ordered list into
    the step's immutable `detail.turns` (`detail.turnCount === detail.turns.length`)
    and **deletes** the active var
    (`cli-broker-step-solidify-detail-turns.md`).
- Turn nodes are the pure `{ role, content }` shape, identical whether referenced
  from an active var or from a step's `detail.turns` (RFC appendix A). Rendering
  reuses the `step read` pipeline: `loadTurnData(store, turns)` → `TurnData[]`
  (via `parseSingleTurn`) → `formatTurnBody` (`step.ts:308`), so per-turn blocks
  are byte-identical across sources and across `step read` / `step turns`.
- The positional argument is a **`<thread-id>`** (a `ThreadId`), NOT a
  `<step-hash>`: the panorama is thread-scoped and the in-flight step has no
  settled StepNode hash to address — its turns live in the `(threadId, role)`
  active var.
- A thread `06FCY...` mid-run: steps `planner` and `developer` are completed
  (each with its own `detail.turns`), and a `reviewer` step is in flight with
  `@uwf/active-turns/06FCY.../reviewer = [h(r1),h(r2),h(r3)]` and no settled
  StepNode yet.

## When
- **Running case** — while `reviewer` is in flight, the user runs:
  ```bash
  uwf step turns 06FCY...
  ```
- **Completed case** — after `reviewer` completes (its active var deleted, turns
  solidified into that step's `detail.turns`), the user runs the same command:
  ```bash
  uwf step turns 06FCY...
  ```
- Unit test (#409): seed the same step's turns two ways for the **same** hashes —
  (a) as an `@uwf/active-turns/<tid>/<role>` var, and (b) the var removed + that
  step's `detail.turns` set to the same `[h(r1),h(r2),h(r3)]` — and assert the
  rendered turn blocks for that step are identical.

## Then
- **Per-step read order**: for each step in the chain panorama, its turns are
  resolved with active-var precedence:
  1. if `readActiveTurns(store, threadId, step.role)` is non-empty (the step is
     in flight), render those live turns and mark the step **`🔄 进行中`**;
  2. otherwise (completed step) render that step's own immutable `detail.turns`
     (resolved via the step's `detail` ref), marked **`✓`**.
  This is the same active→detail precedence as before, but **scoped to each
  step's own role**, applied while walking the chain — never only the head.
- **Running case output**: the in-flight `reviewer` step lists all turns produced
  so far (`r1`, `r2`, `r3`) from its active var, rendered through the reused
  `loadTurnData` + `formatTurnBody` pipeline (`## Turn N` → `**Turn role:**
  assistant` → `content`), in arrival order, beneath a `🔄 进行中` step header;
  the already-completed `planner`/`developer` steps render from their
  `detail.turns` above it.
- **Completed case output**: the `reviewer` step renders the **same** turns from
  its `detail.turns`, **byte-identical per-turn blocks**, now under a `✓` header —
  because the solidified `detail.turns` equals the active var's contents captured
  at completion (`cli-broker-step-solidify-detail-turns.md`) and the **same**
  renderer is used. The active→detail source switch is transparent to the user at
  the turn-block level (only the step's status mark flips `🔄 进行中` → `✓`).
- **No turn lost across the handoff**: a turn appended in the instant the var is
  solidified+deleted is not dropped — once a step is completed its full
  `detail.turns` is the source of truth, so the panorama shows every produced
  turn exactly once whether observed mid-flight or after completion.
- Each rendered turn's `content` matches the stored turn node's `content` exactly
  (no trimming / re-parse); each resolved turn hash is gettable in CAS as a
  `{ role, content }` node.
- **Edge handling** (graceful, exit 0):
  - a step whose `detail === null` or `detail.turns === []` and with no active
    var contributes **zero** turn blocks but still appears as a group header
    `(0 turns)` (`step-turns-chain-panorama.md`) — it is not dropped;
  - head is a StartNode (no steps yet) and no active var → header-only panorama,
    no `## Turn` blocks;
  - unknown thread → `thread not found: <id>` (matching `resolveHeadHash`),
    exit non-zero.

## Notes
- The headline guarantee is **source-transparency per step**: the same step's
  turns render identically whether sourced live (active var, `🔄 进行中`) or
  frozen (`detail.turns`, `✓`); only the step-level status marker differs. The
  step group header MAY differ from `step read`'s `# Step <hash>` (the panorama
  groups by role/step, e.g. `## reviewer ✓ (3 turns)`); the asserted equality is
  over the **per-turn `## Turn N` blocks**, which are hash/role-agnostic.
- Reusing `loadTurnData`/`formatTurnBody` inherits forward-compatible shape
  handling: turns render from `{role, content}` and tolerate extra fields
  (`index`, `toolCalls`) when a future producer writes them (see the
  `step-commands` card).
- This per-step sourcing is the mechanism behind the #409 fix: walking the chain
  and reading **each** step's own active-or-detail turns makes the head-only
  `readHeadDetailTurns` (and its #408 role guard) obsolete — see
  `step-turns-role-selection.md`.
- Cross-process visibility of the in-flight step's active var is the Phase 2
  guarantee (`cli-broker-step-cross-process-visibility.md`); `--live` follows it
  (`step-turns-live-poll-active-var.md`).
