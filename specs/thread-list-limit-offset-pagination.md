---
scenario: "uwf thread list accepts --limit <n> / --offset <m> pagination flags (the repo-wide ListOptions vocabulary, matching step turns); they slice the newest-first thread list, reusing the existing internal cmdThreadList skip/take pagination, with --skip/--take kept as backward-compatible aliases"
feature: thread
tags: [cli, thread-list, pagination, limit, offset, list-options, "451"]
---

## Given
- Issue #451: `uwf thread list` does not accept a `--limit` flag — passing it
  today errors with `unknown option` (cli-kit rejects the undeclared flag,
  exit non-zero). When many threads exist (currently 20+), there is no way to
  cap the output from this command.
- The turn-layer command `step turns` already exposes `--limit <n>` /
  `--offset <m>` (`packages/cli/src/cli.ts`, the `step turns` registration,
  parsed by `parseTurnsPageOption`). Those names are the repo-wide `ListOptions`
  vocabulary (OCAS core `type ListOptions = { sort?; desc?; limit?; offset? }`,
  absent `limit` = "no limit"). `thread list` should speak the same vocabulary.
- **The pagination engine already exists** for `thread list`: `cmdThreadList`
  (`packages/cli/src/commands/thread.ts`) already takes `skip` and `take`
  parameters and applies them via `applyPagination(items, skip, take)` =
  `items.slice(skip ?? 0, (skip ?? 0) + (take ?? items.length))`, **after**
  status/time filtering and **after** `sortByNewestFirst`. The gap is purely at
  the CLI flag layer: the `thread list` subcommand registration only declares
  `--skip`/`--take` (parsed by `parsePaginationOptions`), not `--limit`/`--offset`.
- **Mapping** (no new pagination engine is written): `--limit` → the existing
  `take` parameter (max items returned), `--offset` → the existing `skip`
  parameter (items skipped from the front of the newest-first list). So
  `--limit 5 --offset 10` ⇒ `cmdThreadList(..., skip=10, take=5, ...)` ⇒
  `items.slice(10, 15)`.
- **Backward compatibility**: the pre-existing `--skip`/`--take` flags continue
  to work unchanged (existing `cmdThreadList pagination` tests in
  `packages/cli/src/__tests__/thread-list-filters.test.ts` — "should limit
  results with --take", "should skip first N threads with --skip", "should
  support skip + take" — stay green). `--limit`/`--offset` are additive
  canonical names, not a rename.

## When
- The user pages through the newest-first thread list using the new flags:
  ```bash
  uwf thread list                              # all active threads (idle+running+corrupt), newest first
  uwf thread list --limit 5                    # only the 5 most recent threads
  uwf thread list --limit 5 --offset 10        # skip the 10 newest, then show the next 5
  uwf thread list --offset 3                   # skip the 3 newest, show the rest
  uwf thread list --all --limit 5              # 5 most recent across ALL statuses
  uwf thread list --status running --limit 5   # 5 most recent running threads
  ```
- The legacy aliases keep working and are equivalent:
  ```bash
  uwf thread list --take 5                      # same as --limit 5
  uwf thread list --skip 10 --take 5            # same as --offset 10 --limit 5
  ```
- Unit/CLI test (#451): create N (>5) threads with distinct timestamps; assert
  `--limit 5` returns the 5 newest, `--limit 5 --offset 10` returns items at
  newest-first indices [10,15), and that `--limit`/`--offset` produce the same
  result as the equivalent `--take`/`--skip`.

## Then
- **Flag registration**: the `thread list` subcommand in `cli.ts` declares
  `--limit` and `--offset` (string-typed, like the other numeric flags), in
  addition to the retained `--skip`/`--take`. Passing `--limit`/`--offset` no
  longer errors with `unknown option`.
- **Parsing & validation**: `--limit`/`--offset` values are parsed into
  non-negative integers reusing `parseTurnsPageOption` (the same helper
  `step turns` uses) — or `parsePaginationOptions` extended to read them.
  Absent flag → `null` (the `ListOptions` "no limit" / offset-0 convention).
  Negative or non-numeric values are a CLI usage error: a message naming the
  flag verbatim (e.g. `--limit must be a non-negative integer`) on stderr and a
  non-zero exit.
- **Semantics (slice over the newest-first list)**: pagination is applied by the
  existing `applyPagination` **last**, after status filter, time-range filter,
  and `sortByNewestFirst`. Therefore:
  - `--limit N` → at most the first **N** items of the (filtered, newest-first)
    list;
  - `--offset M` → skip the first **M** items (the M newest);
  - combined → the slice `[M, M+N)` over the newest-first order;
  - the slice is over **threads**, after all other filters — `--status` /
    `--all` / `--after` / `--before` restrict the set first, then
    `--offset`/`--limit` page the remainder.
- **`--limit`/`--offset` map to `take`/`skip`**: `cmdThreadList` is invoked with
  `skip` ← `--offset` (or `--skip`) and `take` ← `--limit` (or `--take`); the
  function signature and `applyPagination` are unchanged.
- **Precedence when both legacy and new given** (deterministic, documented):
  if both `--limit` and `--take` (resp. `--offset` and `--skip`) are supplied,
  the canonical `--limit`/`--offset` wins (the legacy alias is the fallback).
  Tester should treat mixing as an unusual path; the common cases are using one
  pair or the other.
- **Backward compatibility holds**: `--skip`/`--take` still parse and behave
  exactly as before; the three existing pagination tests pass without
  modification. `cmdThreadList(tmpDir, null, null, null, 3, null)` still returns
  the 7 oldest of 10, etc.
- **Boundaries** (graceful, exit 0):
  - `--offset` ≥ total items → empty list output (a well-formed empty
    `thread-list` payload / "no threads" render, not an error);
  - `--limit 0` → follows the `ListOptions` convention (no items returned); an
    **absent** `--limit`, by contrast, means all items;
  - `--limit`/`--offset` larger than the remaining count clamp to the available
    range (`slice` is naturally clamping — no error);
  - negative or non-numeric → CLI usage error, non-zero exit (per parsing above).
- **Ordering invariant**: because pagination is the final step over a stable
  newest-first sort, a thread keeps its position across calls — `--offset 5`
  then `--offset 5 --limit 5` walk a contiguous, non-overlapping window of the
  same ordering (modulo concurrent thread creation).

## Notes
- This is fundamentally a **vocabulary alignment** fix, not new pagination
  logic: the slice engine (`applyPagination`), the newest-first sort, and the
  `cmdThreadList` `skip`/`take` parameters already exist and are tested. #451
  only wires the canonical `ListOptions` flag names through to them so
  `thread list` matches `step turns`.
- Reusing `parseTurnsPageOption` keeps validation identical between
  `step turns` and `thread list` (same "non-negative integer" rule, same
  flag-named error). If `parsePaginationOptions` is extended instead, keep its
  error wording (`--limit must be a non-negative integer`) consistent with the
  `step turns` helper.
- Keeping `--skip`/`--take` as aliases avoids a breaking change to the published
  `@united-workforce/cli` surface and to existing tests/README/usage-reference;
  the docs/changeset acceptance gates are captured in
  `thread-list-limit-offset-docs-changeset.md`.
- Any new logging at added call sites must use the structured `log(tag, msg)`
  helper with a fresh unique 8-char Crockford Base32 tag (CLAUDE.md), not
  `console.*` (the user-facing result-printing exception is unaffected).
