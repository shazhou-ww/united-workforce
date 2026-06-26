---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

feat(thread-list): add `--limit`/`--offset` pagination to `uwf thread list` (#451)

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
