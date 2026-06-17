---
scenario: "makeOnTurn callback writes each turn with prev pointer and owner reference"
feature: broker-step
tags: [broker-step, turn-chain, onturn, prev, owner, phase2]
---

## Given

- An in-memory UwfStore with Phase 1 turn chain schemas registered
- A thread with ID `tid_test`
- A step-start node SS0 already written to CAS with hash `<SS0>`
- The active-step var `@uwf/active-step/<tid_test>` points to `<SS0>`
- The active-turn-head var `@uwf/active-turn-head/<tid_test>` does not exist (no prior turns)

## When

- Create the onTurn callback via `makeOnTurn(uwf, threadId)`
- Simulate 3 broker turns arriving in sequence:
  - Turn 0: `{ content: "First analysis", hash: "sumeru_t0" }`
  - Turn 1: `{ content: "Continued work", hash: "sumeru_t1" }`
  - Turn 2: `{ content: "Final output", hash: "sumeru_t2" }`
- Call `onTurn(turn)` for each turn in order

## Then

- Three turn nodes are written to CAS, each with the `TurnNodePayload` schema
- Turn 0's node has:
  - `role: "assistant"`
  - `content: "First analysis"`
  - `prev: null` (first turn in the chain)
  - `owner: <SS0>` (references the active step-start)
- Turn 1's node has:
  - `prev: <T0>` (hash of turn 0)
  - `owner: <SS0>`
- Turn 2's node has:
  - `prev: <T1>` (hash of turn 1)
  - `owner: <SS0>`
- The `@uwf/active-turn-head/<tid_test>` var now points to `<T2>` (the most recent turn)
- Walking from `<T2>` via prev yields [T0, T1, T2] in chronological order
- All three turns have `owner == <SS0>`
