---
"@united-workforce/cli": patch
---

Migrate remaining example workflows from Handlebars triple-brace `{{{var}}}` syntax to Liquid `{{ var }}` syntax. Updates `examples/e2e-walkthrough.yaml` (12 occurrences), `examples/normalize-bun-monorepo.yaml` (22 occurrences), and `examples/solve-issue.yaml` (11 occurrences). The 0.4.0 LiquidJS-based validator rejected the old syntax with `template variable "unknown" not found` errors. Fixes #307.
