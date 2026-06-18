---
scenario: "Leading-whitespace tolerance does NOT extend to leading prose, code-fence wrapping, or incomplete blocks — those still return no-frontmatter, and the doc comment is updated to reflect the trim"
feature: frontmatter
tags: [frontmatter, parsing, scope, out-of-scope, docs, issue-429]
---

## Given
- The issue scopes the fix to ONLY the trim layer. Explicitly out of scope (deferred until data shows they are high-frequency):
  - leading PROSE / substantive text before the fence (e.g. `"Here is my output:\n---\nstatus: done\n---"`)
  - markdown code-fence wrapping (e.g. a ```` ```yaml ```` block around the frontmatter)
  - regex full-text scanning for the first fence block anywhere in the document
- The block itself must still be a complete `---\n...\n---` after leading whitespace is stripped

## When
- `parseFrontmatterMarkdown(raw)` / `splitFrontmatter(raw)` / `extractYamlBlock(raw)` are invoked on out-of-scope or malformed inputs:
  1. leading prose: `"Here is my output:\n---\nstatus: done\n---\n\nbody"`
  2. code-fence wrapped: ` "```yaml\n---\nstatus: done\n---\n```" `
  3. no closing fence: `"\n---\nstatus: done\nbody with no close"`
  4. only whitespace, no fence: `"   \n\n   "`

## Then
- Case 1 (leading prose): `frontmatter` is `null` and `body` is the full original `raw`. Stripping whitespace does NOT remove the prose `Here is my output:`, so `startsWith("---")` is still false. This output would still trigger a retry — intentionally unhandled by this issue
- Case 2 (code-fence wrapped): `frontmatter` is `null` — the leading ```` ``` ```` is not whitespace, so the fence is not at the (stripped) start; no regex scanning is introduced to find the inner `---`
- Case 3 (no closing fence): after the opening fence is matched, `indexOf("\n---")` returns -1, so `splitFrontmatter` returns `{ yaml: null, body: raw }` and `extractYamlBlock` returns `null` — an incomplete block is rejected exactly as before
- Case 4 (only whitespace): trimming leaves an empty string that does not start with `---`; `frontmatter` is `null`
- **Doc comment updated:** the comment block near `frontmatter-markdown.ts:15-16` no longer claims the block "MUST Start at character position 0 with `---` (no leading whitespace / BOM)". It is reworded to state that leading whitespace (newline / CR / space / tab / BOM) is tolerated and stripped before the fence check, while the block itself must still be a complete `---\n...\n---`
