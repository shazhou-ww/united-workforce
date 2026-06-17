---
scenario: "Step completion no longer solidifies turns into detail.turns"
feature: broker-step
tags: [broker-step, detail, turn-chain, phase2]
---

## Given

- An in-memory UwfStore with Phase 2 schemas registered
- A step that produced 3 turns (T1, T2, T3) during execution
- Each turn is already written to CAS with `prev` and `owner` fields
- The `@uwf/active-turn-head/<tid_test>` points to T3

## When

- `executeBrokerStep` completes and writes the step-complete node

## Then

**Detail node structure change:**
- The step-complete's `detail` field points to a detail node
- The detail node does NOT contain a `turns` array (removed)
- The detail node contains:
  - `sessionId: string` — Sumeru session ID
  - `duration: number` — step duration in ms
  - `turnCount: number` — number of turns (for stats, not reconstruction)
- The `turnCount` equals 3 (the number of turns produced)

**Turn retrieval path change:**
- To get a step's turns, use `turnsOfStep(turnHead, stepStartHash)`
- Do NOT read `detail.turns` (deprecated path)
- Turns are self-contained via their `prev` and `owner` references

**Backward compatibility:**
- Legacy detail nodes with `turns` array can still be read
- New code should prefer the turn chain walk over detail.turns
- Phase 3 consumer will use `turnsOfStep()` exclusively

**Why:**
- Turns are already persisted with `prev` + `owner` — no need to duplicate them in detail
- The turn chain IS the source of truth for turn order and ownership
- `detail.turns` was redundant and is now removed
