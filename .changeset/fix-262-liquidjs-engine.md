---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

Replace Mustache template engine with LiquidJS for edge prompt and location rendering.

- Swap `mustache` dependency for `liquidjs` in cli package
- Rewrite moderator `evaluate()` to use `Liquid.parseAndRenderSync()`
- Rewrite validator to use LiquidJS strict-render instead of regex extraction
- Migrate all `.workflows/*.yaml` from `{{{var}}}` to `{{ var }}` syntax
- Update workflow authoring reference documentation
