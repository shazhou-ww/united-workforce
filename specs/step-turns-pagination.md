---
scenario: "uwf step turns defaults to showing all turns (no truncation); --limit N / --offset M paginate the flattened cross-step turn sequence, applied after any --role filter, reusing the OCAS ListOptions convention"
feature: step
tags: [cli, step-turns, turns, pagination, limit, offset, list-options, chain, "409"]
---

## Given
- Issue #409, design decision #2 ("默认全量不截断", 方案 A) and #3 ("分页用
  `--limit` / `--offset`"). The whole-chain panorama
  (`step-turns-chain-panorama.md`) shows **all** turns by default; `--limit` and
  `--offset` are the opt-in pagination knobs.
- **Default = no limit**: when neither flag is given, every turn of every
  (role-filtered) step is rendered. This matches OCAS core's existing
  `ListOptions` convention (`~/repos/ocas/packages/core/src/types.ts`:
  `type ListOptions = { sort?; desc?; limit?; offset? }`) where an absent
  `limit` means "no limit" — `step turns` reuses that convention rather than
  inventing a new "show everything" flag. The semantics are literally "show all
  turns"; a human who finds it long pipes to `| less` or passes `--limit`.
- The flag names are exactly `--limit <N>` and `--offset <M>` — the repo-wide
  `ListOptions` vocabulary — not bespoke names like `--head`/`--tail`/`--count`.
- Pagination operates on the **flattened turn sequence**: the panorama's per-step
  turn lists are concatenated, in chain order, into one continuous sequence of
  turns numbered **across** steps (not per-step). `--limit`/`--offset` slice that
  flat sequence — they are **not** "show N steps" and **not** per-step paging.
- A thread `06FCY...` with steps whose turn counts are e.g.
  `planner(3) → developer(47) → reviewer(12)` → a flattened sequence of 62 turns
  (global indices 0..61).

## When
- The user pages through the flattened turn sequence:
  ```bash
  uwf step turns 06FCY...                          # all 62 turns
  uwf step turns 06FCY... --limit 10               # first 10 turns
  uwf step turns 06FCY... --offset 50              # turns 50..61 (12 turns)
  uwf step turns 06FCY... --offset 50 --limit 5    # turns 50..54
  uwf step turns 06FCY... --role developer --limit 10   # first 10 developer turns
  ```
- Unit test (#409): build a multi-step panorama with known per-step turn counts
  and assert the rendered turn set equals the expected flat slice for various
  `--limit`/`--offset` (and `--role` + pagination) combinations.

## Then
- **Default (no flags)**: all turns render, untruncated — no quota cutoff and no
  `_[Earlier turns omitted…]_` notice (that notice belongs to `step read`'s quota
  path, not `step turns`).
- **`--limit N`**: render at most the **first N** turns of the flattened
  sequence (after `--offset`); `--offset M`: **skip the first M** turns of the
  flattened sequence. Combined, they yield the slice `[M, M+N)` over the global
  turn order. The slice is over **turns**, spanning step boundaries — e.g.
  `--offset 50 --limit 5` on `planner(3)+developer(47)+reviewer(12)` returns the
  last developer turn (global 49 is the 47th developer turn → index 49) onward
  into reviewer, exactly indices 50..54 of the flat sequence.
- **Filter-then-paginate ordering**: `--role` is applied **first** (restrict the
  panorama to that role's steps, `step-turns-role-selection.md`), **then**
  `--limit`/`--offset` slice the flattened sequence of the **remaining** turns.
  So `--role developer --limit 10` is the first 10 turns among developer steps
  only, not the first 10 turns of the whole thread filtered down.
- **Step grouping preserved**: a slice that spans steps still renders each
  surviving turn under its owning step group header (with role + `✓`/`🔄 进行中`
  marker); a step group whose turns are entirely sliced out does not appear (or
  appears with zero turns) — pagination removes **turns**, the grouping of the
  surviving turns is unchanged.
- **Boundaries** (graceful, exit 0):
  - `--offset` ≥ total turns → empty turn output (header/groups only, no
    `## Turn` blocks);
  - `--limit 0` → follows the `ListOptions` convention (no turns rendered; an
    absent limit, by contrast, means all turns);
  - `--limit`/`--offset` larger than the remaining count clamp to the available
    range (no error);
  - negative or non-numeric values are rejected as a CLI usage error
    (@ocas/cli-kit option parsing), exit non-zero.
- **Global numbering**: because pagination is over the flattened sequence, turn
  numbering/identity is consistent across the whole panorama (a turn keeps its
  place in chain order regardless of which slice surfaces it).

## Notes
- Why default-all (方案 A): "语义最纯粹「显示所有」，符合 OCAS core
  「limit: undefined = 无限制」既有约定". `step turns` is the turn-layer query;
  an agent consuming it wants the full set, a human who wants less reaches for
  `--limit` or a pager. This is a deliberate departure from `step read`, which
  is quota-bounded and back-fills newest-first.
- `--limit`/`--offset` reuse the `ListOptions` field names for repo-wide
  consistency; they are CLI options translated to a slice over the in-memory
  flattened turn array (the turns are already materialized from CAS during chain
  traversal — this is not a CAS `listByType` call).
- Cross-refs: `step-turns-chain-panorama.md` (the flattened sequence comes from
  the chain traversal), `step-turns-role-selection.md` (the `--role` filter that
  precedes pagination), `step-turns-docs-and-changeset.md` (help text for the new
  flags).
