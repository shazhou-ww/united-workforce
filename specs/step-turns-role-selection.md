---
scenario: "uwf step turns <thread-id> --role X filters the chain panorama to that role's steps (across the whole thread), so on a multi-step thread whose head is a different role, --role developer returns the developer step's turns — fixing #409 where it returned empty"
feature: step
tags: [cli, step-turns, turns, role, chain, regression, "409", "408", "400"]
---

## Given
- Issue #409. The new `step turns` walks the **whole** thread chain and groups
  turns by their owning step/role (`step-turns-chain-panorama.md`). `--role X`
  is now a **filter over that panorama**: keep only the steps whose
  `StepNodePayload.role === X` (plus the in-flight step when its active var is
  the `(threadId, X)` var), then render those steps' turns.
- **The bug being fixed**: previously `--role` was resolved via
  `readHeadDetailTurns(uwf, entry.head, role)` — reading **only the thread
  head** StepNode's `detail.turns`, "role-aware" by returning `[]` when the
  head step's `role !== role`. On a completed multi-step thread whose head is a
  *different* role, the queried role's turns live on an **earlier** step in the
  chain and were therefore **unreachable** — `--role` returned empty. The #408
  role guard correctly stopped the head's turns leaking under the wrong role,
  but the underlying head-only read was the real defect: it should have walked
  the chain to the role's own step.
- The fix reuses the chain traversal `cmdStepList` already uses (`walkChain` +
  `collectOrderedSteps`, `shared.ts:29`/`172`); after collecting all steps it
  filters by `StepNodePayload.role`. No `readHeadDetailTurns` head-role hack is
  needed — each step's turns are read from that step's own `detail.turns`.
- Fixture thread `06FCYMS8GH6PWF1M278F27KWA0`: 9 steps
  `planner → developer → reviewer → tester → committer` (two rounds),
  head = `committer`. `uwf step read 8WGMP2A3T9ZSF` (the developer step) reads
  the developer turns fine; the `--role developer` query is what regressed.
- Fixture thread `06FCZ...`: a completed two-role run `planner → coder`, head =
  the **coder** step (`role:"coder"`, `detail.turns=[h(c1),h(c2)]`); the planner
  step (`detail.turns=[h(p1)]`) is reachable only via `prev`.

## When
- The user filters the panorama to one role on a multi-step thread:
  ```bash
  uwf step turns 06FCYMS8GH6PWF1M278F27KWA0 --role developer   # head is committer
  uwf step turns 06FCZ... --role planner                       # head is coder
  uwf step turns 06FCZ... --role coder
  uwf step turns 06FCZ... --role reviewer                      # never ran
  ```
- Unit test (#409 core regression): seed the completed multi-step chain with
  head = a *late* role (e.g. `committer`/`coder`) and per-step `detail.turns`,
  then drive `cmdStepTurns(..., { role: "developer"/"planner", live:false })`
  and assert the **earlier** role's turns are returned (the case that returned
  empty before).

## Then
- **`--role developer` on a `head=committer` thread returns the developer step's
  turns** (the chain is walked to the developer step and its `detail.turns`
  rendered) — **not empty**. This is the explicit regression the issue calls
  out: "step turns --role developer 必须返回 developer step 的 turn（当前返回
  空——这是本 issue 要修的核心）".
- On `06FCZ...` (head = coder step):
  - `--role coder` renders the coder step's turns `["c1","c2"]` in order;
  - `--role planner` renders the **planner** step's turns `["p1"]` — reached by
    walking `prev` from the coder head to the earlier planner step — **not
    empty** (the pre-#409 behaviour) and never the coder head step's turns;
  - `--role reviewer` (a role with no step on this thread) renders **empty**
    (header/role line only, no `## Turn` blocks, exit 0) — there is simply no
    step matching that role to include.
- **Multiple steps of the same role aggregate**: if a role ran more than once
  (e.g. `developer` in both rounds of the 9-step fixture), `--role developer`
  includes **all** developer steps in chronological order — `--role` filters the
  whole-chain step list, it is not limited to the most recent occurrence.
- The filtered output preserves the panorama's per-step grouping and markers
  (`step-turns-chain-panorama.md`): each retained step keeps its `## developer ✓
  (N turns)` (or `🔄 进行中` for an in-flight matching step) header; only
  non-matching-role steps are dropped.
- `--role` is exact-match on the role name (same `exactName` semantics the
  active var uses): `--role coder` matches neither `coder-2` nor any other role.
- **No leakage, structurally**: because turns are sourced per-step from each
  step's own `detail.turns`, a wrong-role step's turns can never surface under
  `--role X` — the #408 head-role guard is unnecessary and removed. The contract
  "selecting a role with no matching step yields an empty turn list (exit 0)"
  still holds, now because the filtered step set is empty, not because a head
  guard returned `[]`.
- `--role` composes with pagination: filter by role first, **then** apply
  `--limit`/`--offset` to the flattened turn sequence (`step-turns-pagination.md`).

## Notes
- This supersedes the pre-#409 contract in the prior revision of this spec, where
  `--role planner` on a `head=coder` thread rendered **empty** "by design"
  (head-only role-aware fallback). Under #409 the chain is walked, so
  `--role planner` now correctly returns the planner step's turns. The forbidden
  behaviour — returning the **head/coder** step's turns under `--role planner` —
  remains forbidden, but the right answer is now *planner's own* turns, not
  empty.
- Default `--role` (when omitted): the panorama shows **all** roles' steps
  (`step-turns-chain-panorama.md`), so omitting `--role` no longer needs to
  pick a single "head role" — it shows everything. (`resolveDefaultTurnsRole`'s
  head-role default existed only because the old command could read one role at
  a time; the whole-chain panorama makes a single default role unnecessary.)
- Cross-refs: `step-turns-chain-panorama.md` (traversal + grouping),
  `step-turns-pagination.md` (filter-then-paginate ordering),
  `step-turns-live-poll-active-var.md` (`--live` follows one role's in-flight
  step).
