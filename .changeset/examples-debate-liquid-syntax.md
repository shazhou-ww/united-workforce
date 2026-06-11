---
"@united-workforce/cli": patch
---

Migrate `examples/debate.yaml` from Handlebars triple-brace `{{{var}}}` syntax to Liquid `{{ var }}` syntax. The 0.4.0 LiquidJS-based validator rejected the old syntax with six `template variable "unknown" not found` errors. Fixes #300.
