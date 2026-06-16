---
scenario: "uwf step turns <thread-id> renders a full-thread panorama — it walks the entire thread chain and shows every step's turns in order (each completed step from its own immutable detail.turns, the in-flight step from its active var marked 🔄 进行中), instead of only the head step's turns"
feature: step
tags: [cli, step-turns, turns, chain, panorama, walk-chain, progress-marker, phase4, "409", "400"]
---

## Given
- Issue #409. Before this change, `uwf step turns <tid>` resolved turns via
  `resolveTurnHashes` → `readHeadDetailTurns(uwf, entry.head, role)`
  (`packages/cli/src/commands/step.ts`), which reads **only the thread head
  StepNode's** `detail.turns`. On a completed multi-step thread the head belongs
  to exactly one role, so every other role's turns were unreachable (this is the
  bug #409 fixes — see `step-turns-role-selection.md` for the regression).
- The new semantics: `uwf step turns <thread-id>` is "**the panorama of every
  turn this thread has produced so far**", not a view of the last step only:
  - walk the **whole** thread chain in chronological order and show **every**
    step's turns, each turn attributed to its owning role/step;
  - **completed steps** → read each step's own solidified, immutable
    `detail.turns` (stitched along the chain to reconstruct full history);
  - the **in-flight step** (its `@uwf/active-turns/<tid>/<role>` var still
    present) → read the active var and mark the step **`🔄 进行中`**, its turns
    visible in real time;
  - **default shows all turns** — no quota truncation (the command's whole point
    is "show all turns"); `--limit`/`--offset` paginate when desired
    (`step-turns-pagination.md`).
- The chain-traversal infrastructure **already exists and must be reused, not
  reinvented**: `cmdStepList` (`step.ts:151`) already enumerates every step via
  `walkChain` + `collectOrderedSteps` (`shared.ts:29` / `shared.ts:172`).
  `collectOrderedSteps(uwf, headHash, chain)` returns `OrderedStepItem[]`
  (`{ hash, payload, timestamp }`) in chronological order following
  `StepNodePayload.prev` from the head back to the StartNode, then reversed.
- A StepNode carries the role that produced it (`StepNodePayload.role`) and a
  `detail` ref whose payload's `turns` is the ordered `CasRef[]` of that step's
  turn nodes. Turn nodes are the pure `{ role, content }` shape shared by the
  active var and `detail.turns`.
- Per-turn rendering reuses the **same** `step read` pipeline:
  `loadTurnData(store, turns)` → `TurnData[]` (via `parseSingleTurn`) →
  `formatTurnBody(turn)` (`step.ts:308`), so a turn block here is byte-identical
  to the same turn under `uwf step read <stepHash>`.
- Fixture thread `06FCYMS8GH6PWF1M278F27KWA0`: 9 steps
  `planner → developer → reviewer → tester → committer` (two rounds),
  head = the final `committer` step; every step's turns are solidified into its
  own `detail.turns`; no active var remains.

## When
- The user asks for the whole-thread turn panorama (no `--role`):
  ```bash
  uwf step turns 06FCYMS8GH6PWF1M278F27KWA0
  ```
- A thread mid-run: process A is executing the `reviewer` step (active var
  `@uwf/active-turns/<tid>/reviewer` present, `planner` and `developer` steps
  already settled in the chain); the user runs `uwf step turns <tid>`.
- Unit test (#409): seed a completed multi-step chain
  (`planner → developer → reviewer → ...`) with per-step `detail.turns`, plus a
  mid-run variant where the latest role has only an active var (no settled
  StepNode yet), and drive `cmdStepTurns(storageRoot, threadId, { live:false })`.

## Then
- **Whole-chain traversal**: the output contains a group for **every** step in
  the chain, in chronological (StartNode→head) order, reconstructed from
  `walkChain` + `collectOrderedSteps` — not just the head step. For the 9-step
  fixture, all 9 step groups appear (`planner`, `developer`, `reviewer`,
  `tester`, `committer`, then the second round), each labelled with its role.
- **Per-step turn sourcing**:
  - each **completed** step renders its **own** `detail.turns` (resolved via the
    step's `detail` ref), so the developer step shows developer's turns, the
    reviewer step shows reviewer's, and so on — full history stitched along the
    chain;
  - the **in-flight** step (active var present, not yet a settled StepNode at the
    head's `prev` lineage) renders the live `@uwf/active-turns/<tid>/<role>` var.
- **Step-level progress marker (granularity = step, not turn)**: each step group
  header carries the role, a status mark, and a turn count — completed steps show
  **`✓`** (e.g. `## developer ✓ (47 turns)`); the in-flight step shows
  **`🔄 进行中`** with a "so far" count (e.g. `## reviewer 🔄 进行中 (12 turns
  so far)`). The marker is per **step**, never per turn — a turn is either fully
  received or absent, there is no "half turn". *(The exact header text/heading
  level is illustrative per the issue's 输出形态示例; the asserted observable
  tokens are: the role name, a `✓` for completed vs `🔄`/`进行中` for the running
  step, and the turn count.)*
- **Turn blocks reuse the pipeline**: under each step group, that step's turns
  render through `loadTurnData` → `formatTurnBody` (a `**Turn role:** <role>`
  line, optional tool-call bullets, then `content`), in arrival order, identical
  to `uwf step read` for that step.
- **Default is full, untruncated**: with no pagination flags every turn of every
  step is rendered — there is no quota cutoff and no
  `_[Earlier turns omitted…]_` notice (that belongs to `step read`). "Show all
  turns" is the literal contract; OCAS core's "`limit: undefined` = no limit"
  convention is honoured.
- **Role-isolation falls out for free**: because each turn is rendered under the
  step/role that produced it, the head-role guard hack
  (`readHeadDetailTurns`'s `payload.role !== role → []`) is **no longer needed** —
  there is no head-only resolution left to leak the wrong role's turns. #408's
  role-isolation concern is structurally eliminated, not patched.
- **Boundaries** (graceful, exit 0):
  - **empty thread** — head is a StartNode (no steps yet): a header-only
    panorama (e.g. `# Thread <tid>`) with no step groups and no `## Turn` blocks;
  - **a step with `turnCount === 0`** (`detail.turns === []` or `detail === null`):
    its group header still appears with `(0 turns)` and no turn blocks beneath —
    the step is not dropped from the panorama;
  - unknown thread → fails with the existing `thread not found: <id>` message
    (matching `resolveHeadHash`), exit non-zero.

## Notes
- The core change is "step turns 从「只读 head step」改为「沿 chain 遍历所有
  step」" using the **existing** `walkChain` + `collectOrderedSteps` that
  `cmdStepList` already relies on — no new chain-walk code.
- `resolveTurnHashes` / `readHeadDetailTurns` (the head-only, role-aware
  fallback added in #408/#400) are superseded by the per-step chain traversal;
  the role-aware head guard they implemented is obsolete under the new design.
- The in-flight step's active var is keyed by `(threadId, role)` only
  (`activeTurnsVarName`), so the running group is discovered from the
  thread-scoped active-turns var(s) rather than from a settled StepNode (the
  in-flight step has no StepNode hash until `exec` writes it).
- Sibling specs: `step-turns-role-selection.md` (`--role` filter + the #409
  regression), `step-turns-read-order-active-then-detail.md` (per-step
  active→detail sourcing & handoff), `step-turns-pagination.md`
  (`--limit`/`--offset`), `step-turns-live-poll-active-var.md` (`--live`).
