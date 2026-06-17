---
scenario: "Removed functions: appendActiveTurn/readActiveTurns/clearActiveTurns role parameter"
feature: store
tags: [store, active-var, deprecation, turn-chain, phase2]
---

## Given

- The `@united-workforce/cli` package's `store.ts` module
- Phase 2 turn chain implementation is active

## When

- Import from `store.ts`
- Attempt to use the old role-keyed active turn functions

## Then

**Removed exports:**
- `appendActiveTurn(store, threadId, role, turnHash)` — no longer exported (role param removed)
- `readActiveTurns(store, threadId, role)` — no longer exported (role param removed)
- `clearActiveTurns(store, threadId, role)` — no longer exported (role param removed)
- `activeTurnsVarName(threadId, role)` — no longer exported (role-keyed naming gone)
- `readActiveTurnRoles(store, threadId)` — no longer exported (role iteration gone)

**Replacement pattern:**
- Turn chain uses thread-level vars only:
  - `@uwf/active-step/<threadId>` — current in-flight step-start
  - `@uwf/active-turn-head/<threadId>` — head of the turn chain
- No per-role var namespace

**Migration:**
- Code that previously called `appendActiveTurn(store, tid, "developer", hash)` must use the new `makeOnTurn` callback which internally manages the thread-level vars
- Code that previously called `readActiveTurns(store, tid, "developer")` must use `turnsOfStep(store, turnHead, stepStartHash)` to get turns for a specific step
- Code that previously called `readActiveTurnRoles(store, tid)` to find in-flight steps must read `@uwf/active-step/<tid>` directly

**Compile-time enforcement:**
- TypeScript compilation fails if old function signatures are used
- No runtime fallback to role-keyed vars
