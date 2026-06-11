---
"@united-workforce/cli": patch
"@united-workforce/util-agent": patch
"@united-workforce/util": patch
---

fix: rename `$body` to `_body` for LiquidJS compatibility

PR #262 replaced Mustache with LiquidJS but `$body` uses a `$` prefix which is
invalid in Liquid template syntax. Rename the engine-injected variable from
`$body` to `_body` so edge prompt templates work correctly.

- `thread.ts`: inject `_body` instead of `$body`
- `validate-semantic.ts`: remove `sanitizeReservedVars` workaround, add `_body` to mock data for strict validation
- `workflow-authoring-reference.ts`: update docs to `_body`
- `socratic-questioning.yaml`: update template references
- `build-thread-progress`: add optional `threadId` parameter so agents can reference their own thread ID
