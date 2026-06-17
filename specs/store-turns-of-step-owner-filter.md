---
scenario: "turnsOfStep returns only turns belonging to a specific step-start"
feature: store
tags: [store, turn-chain, owner, phase1]
---

## Given

- An empty CAS store
- Three step-start nodes: SS0, SS1, SS2
- Six turn nodes with owner assignments (2 turns per step):
  - T0, T1: owner = SS0
  - T2, T3: owner = SS1
  - T4, T5: owner = SS2
- All turns are linked via `prev` into a single chain: T0 -> T1 -> T2 -> T3 -> T4 -> T5

## When

- Call `turnsOfStep(store, T5, SS1)` (head = T5, stepStartHash = SS1)

## Then

- Returns exactly 2 CasRef hashes
- The returned hashes are T2 and T3 (the turns where owner == SS1)
- Order is chronological: [T2, T3]
- Turns T0, T1, T4, T5 are NOT included (they belong to other steps)
