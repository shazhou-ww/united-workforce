---
scenario: "Protocol Target.location JSDoc says Liquid instead of mustache"
feature: workflow
tags: [docs, liquidjs, migration, protocol, types]
---

## Given
- `packages/protocol/src/types.ts` defines the `Target` type
- The `location` field has a JSDoc comment currently reading "Optional working directory override via mustache template."

## When
- The JSDoc comment for `Target.location` is updated

## Then
- Line 61 JSDoc reads: "Optional working directory override via Liquid template."
- The word "mustache" (case-insensitive) does NOT appear anywhere in `packages/protocol/src/types.ts`
- `pnpm run typecheck` passes for `packages/protocol`
