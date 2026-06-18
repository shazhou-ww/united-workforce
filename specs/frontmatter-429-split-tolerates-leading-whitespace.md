---
scenario: "splitFrontmatter strips leading whitespace (newline/CR/space/tab/BOM) before the fence check so leading-whitespace outputs extract on the first pass with zero regression for clean-top inputs"
feature: frontmatter
tags: [frontmatter, parsing, util, regression, perf, retry, issue-429]
---

## Given
- `packages/util/src/frontmatter-markdown/frontmatter-markdown.ts` defines `splitFrontmatter(raw)`, the main extraction path consumed by `parseFrontmatterMarkdown(raw)`
- Before this change, line 22 used a bare `if (!raw.startsWith(FENCE)) return { yaml: null, body: raw }`, so any leading newline / space / tab / BOM made `startsWith("---")` false → `yaml: null` → `tryFrontmatterFastPath` returns `null` → the engine fires a `frontmatter retry` (a full extra agent round on the same Sumeru session)
- `FENCE` is the 3-char string `"---"`
- The fix scope is ONLY the trim layer: tolerate leading whitespace before the opening fence, but the block itself must still be a complete `---\n...\n---`

## When
- `parseFrontmatterMarkdown(raw)` (which calls `splitFrontmatter`) is invoked on each of the following inputs (JS string literals):
  1. clean-top: `"---\nstatus: done\n---\n\nBody text"`
  2. leading newline: `"\n---\nstatus: done\n---\n\nBody text"`
  3. leading spaces: `"  ---\nstatus: done\n---\n\nBody text"`
  4. leading BOM: `"\uFEFF---\nstatus: done\n---\n\nBody text"`

## Then
- Before checking the opening fence, `splitFrontmatter` strips leading whitespace — newline `\n`, carriage return `\r`, space, tab `\t`, and BOM `\uFEFF` (a plain `trimStart()` covers all five, since `\uFEFF` is ECMAScript WhiteSpace)
- All four inputs now extract successfully and identically:
  - `frontmatter` is non-null with `status === "done"`
  - `body === "Body text"` for every case (the body is computed from the whitespace-stripped string, so content is NOT corrupted, no stray leading/trailing characters, no dropped first body line)
- **Zero regression (clean-top guard):** case 1 produces exactly the same `{ frontmatter, body }` it produced before the change — `frontmatter.status === "done"` and `body === "Body text"`. The trim is a no-op when there is no leading whitespace
- The block-completeness invariant is unchanged: the stripped string must still begin with `---` immediately followed by a newline (or be the empty-frontmatter `---\n---` edge case) AND be closed by a later `\n---`; otherwise `frontmatter` is `null` (see the out-of-scope spec)
- Because extraction now succeeds on the first pass for leading-whitespace outputs, `tryFrontmatterFastPath` returns a candidate instead of `null`, so NO frontmatter retry is triggered for these inputs
