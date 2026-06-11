---
"@united-workforce/cli": minor
"@united-workforce/util": minor
---

Bundle 3 general-purpose example workflows (debate, brainstorm, socratic-questioning) into the CLI package. `uwf setup` now auto-registers them so users can run them immediately without manual `workflow add`.

Add `$body` as an engine-injected Liquid template variable in edge prompts. `{{ $body }}` resolves to the markdown body (after frontmatter) from the previous step's output, enabling full prose to flow between roles instead of only frontmatter field summaries. Defining `$body` in a frontmatter schema is rejected by the validator as a reserved property.
