---
scenario: "walkTurnChain traverses turns via prev pointers in order"
feature: store
tags: [store, turn-chain, phase1]
---

## Given

- An empty CAS store
- Six turn nodes written in order with `prev` links:
  - turn 0: `{ role: "assistant", content: "Step 1 analysis", prev: null, owner: <SS0> }`
  - turn 1: `{ role: "assistant", content: "Step 1 continued", prev: <T0>, owner: <SS0> }`
  - turn 2: `{ role: "assistant", content: "Step 2 start", prev: <T1>, owner: <SS1> }`
  - turn 3: `{ role: "assistant", content: "Step 2 continued", prev: <T2>, owner: <SS1> }`
  - turn 4: `{ role: "assistant", content: "Step 3 start", prev: <T3>, owner: <SS2> }`
  - turn 5: `{ role: "assistant", content: "Step 3 final", prev: <T4>, owner: <SS2> }`
- Each turn is written via `writeTurnNode(store, payload)`

## When

- Call `walkTurnChain(store, T5)` where T5 is the head (most recent turn)

## Then

- Returns an array of 6 CasRef hashes
- The order is chronological (oldest first): [T0, T1, T2, T3, T4, T5]
- Each hash in the result can be retrieved via `store.cas.get(hash)`
- The content of each turn matches what was written
