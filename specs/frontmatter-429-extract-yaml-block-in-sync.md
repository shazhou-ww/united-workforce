---
scenario: "extractYamlBlock in util-agent strips leading whitespace before the fence check in lockstep with splitFrontmatter, so parseRawFrontmatterFields still recovers all fields when the output has a leading newline/space/BOM"
feature: util-agent
tags: [frontmatter, parsing, util-agent, raw-fields, sync, issue-429]
---

## Given
- `packages/util-agent/src/frontmatter.ts` defines a second, independent copy of the fence detector: `extractYamlBlock(raw)`, used by `parseRawFrontmatterFields(raw)`
- `parseRawFrontmatterFields` feeds `buildCandidate(...)` inside `tryFrontmatterFastPath` (role-schema fields) and also backs `trySuspendFastPath` (reads `$status` / `reason`)
- Before this change, line 29 used a bare `if (!raw.startsWith(fence)) return null`, identical to the un-fixed `splitFrontmatter`
- CRITICAL invariant from the issue: both spots MUST be changed in sync. If only `splitFrontmatter` (util) is trimmed but `extractYamlBlock` (util-agent) is not, then for a leading-whitespace output the main parse passes (`frontmatter` non-null) but `parseRawFrontmatterFields` returns `{}` — so non-standard schema fields (and `$status` / `reason` for suspend) are silently dropped, producing a candidate that fails schema validation and STILL triggers a retry / wrong result

## When
- `parseRawFrontmatterFields(raw)` is invoked (directly, or via `tryFrontmatterFastPath` / `trySuspendFastPath`) on outputs with leading whitespace, e.g.:
  - leading newline: `"\n---\nstatus: done\nbranch: fix/x\n---\n\nbody"`
  - leading spaces: `"  ---\nstatus: done\nbranch: fix/x\n---\n\nbody"`
  - leading BOM: `"\uFEFF---\nstatus: done\nbranch: fix/x\n---\n\nbody"`

## Then
- `extractYamlBlock` strips the same leading-whitespace set as `splitFrontmatter` (newline `\n`, CR `\r`, space, tab `\t`, BOM `\uFEFF`) before checking `startsWith(fence)`, using the same approach (`trimStart()`) so the two detectors stay byte-for-byte in agreement on what counts as a frontmatter block
- For every leading-whitespace input above, `extractYamlBlock` returns the YAML body string `"status: done\nbranch: fix/x"` (NOT `null`), so `parseRawFrontmatterFields` returns `{ status: "done", branch: "fix/x" }` — fields are preserved, none dropped
- The returned YAML block excludes the opening/closing fences and is computed from the stripped string, so the inner content is not corrupted
- **In-sync guarantee:** for any single `raw`, `extractYamlBlock(raw) === null` if and only if `splitFrontmatter(raw)` yields `yaml === null`. The two never disagree, so a leading-whitespace output that passes the main parse also yields its raw fields (no "main passed but fields dropped" split-brain)
- Clean-top inputs (no leading whitespace) are unaffected — `extractYamlBlock` returns exactly what it returned before (zero regression)
