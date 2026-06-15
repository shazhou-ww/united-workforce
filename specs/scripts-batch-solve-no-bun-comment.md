---
scenario: "Batch solve script usage comments reference pnpm instead of bun"
feature: scripts
tags: [chore, bun-removal, scripts]
---

## Given

- `scripts/batch-solve.sh` line 9 area contains a usage example referencing `bun run`

## When

- Inspect the usage comments in `scripts/batch-solve.sh`

## Then

- The example uses `pnpm run` or `node`/`tsx` instead of `bun run`
- e.g. `--agent "pnpm --filter @united-workforce/agent-claude-code exec uwf-claude-code"` or similar pnpm-based invocation
