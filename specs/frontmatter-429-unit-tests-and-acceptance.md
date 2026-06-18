---
scenario: "New unit tests cover the clean-top regression guard plus three leading-whitespace cases, and the acceptance gate (pnpm test / build / biome check) is green"
feature: frontmatter
tags: [frontmatter, tests, acceptance, regression, issue-429]
---

## Given
- The fix touches two files: `packages/util/src/frontmatter-markdown/frontmatter-markdown.ts` (`splitFrontmatter`) and `packages/util-agent/src/frontmatter.ts` (`extractYamlBlock`)
- Before this change there were no dedicated unit tests for frontmatter leading-whitespace handling under `packages/util/src/__tests__/` or `packages/util-agent/src/__tests__/`
- The repo's acceptance gate is `pnpm build` (tsc composite), `pnpm test` (vitest), and `pnpm check` (biome lint)

## When
- New vitest unit tests are added exercising `parseFrontmatterMarkdown` (and, where it backs raw-field recovery, `parseRawFrontmatterFields` / `tryFrontmatterFastPath`) against the issue's minimal-repro table

## Then
- The test suite includes at minimum these four cases, matching the first four rows of the issue's minimal-repro table:
  1. **clean-top (regression guard):** input `"---\nstatus: done\n---\n\nBody text"` → `frontmatter.status === "done"`, `body === "Body text"`. Asserts the pre-existing behaviour is byte-for-byte unchanged
  2. **leading newline:** input `"\n---\nstatus: done\n---\n\nBody text"` → now extracts: `frontmatter.status === "done"`, `body === "Body text"`
  3. **leading spaces:** input `"  ---\nstatus: done\n---\n\nBody text"` → now extracts: `frontmatter.status === "done"`, `body === "Body text"`
  4. **leading BOM:** input `"\uFEFF---\nstatus: done\n---\n\nBody text"` → now extracts: `frontmatter.status === "done"`, `body === "Body text"`
- For cases 2–4 the tests assert `frontmatter` is non-null (previously it was `null` → retry). The body assertion guards against body corruption from the strip
- A test asserts the two detectors stay in sync: for a leading-whitespace input carrying a non-standard field (e.g. `branch`), `parseRawFrontmatterFields` returns that field (not `{}`), proving `extractYamlBlock` was trimmed in lockstep with `splitFrontmatter`
- `pnpm build` completes with no TypeScript errors
- `pnpm test` is green — all new and pre-existing tests pass
- `pnpm check` (biome) reports no lint errors and the changed files are formatted
