---
"@united-workforce/cli": patch
"@united-workforce/util": patch
---

fix(cli): swap `.workflow/` vs `.workflows/` primary/legacy semantics (#187)

`.workflows/` (plural) is now the primary auto-discovery directory and
`.workflow/` (singular) is the legacy fallback. When both exist in the same
directory, `.workflows/` entries win on name collisions. Projects using only
`.workflow/` continue to work without changes — discovery falls back to it
when `.workflows/` is absent.

The `@united-workforce/util` reference strings (`generateUsageReference`,
`generateCliReference`, `generateWorkflowAuthoringReference`) are updated to
recommend `.workflows/` as the primary placement strategy and document
`.workflow/` as a legacy fallback.
