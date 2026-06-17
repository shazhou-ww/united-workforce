---
scenario: "Legacy turn nodes without prev/owner fields read as null"
feature: store
tags: [store, turn-chain, legacy, phase1]
---

## Given

- A CAS store containing legacy turn nodes (written by old code)
- Legacy turn format: `{ role: "assistant", content: "Some output" }` (no `prev`, no `owner`)
- The legacy turn is stored with the new turn schema (schema accepts null for prev/owner)

## When

- Read the legacy turn via `store.cas.get(legacyTurnHash)`
- Attempt to use the turn in `walkTurnChain` (if it's the only turn)
- Attempt to use the turn in `turnsOfStep`

## Then

- Reading the legacy turn succeeds (no crash)
- The turn payload's `prev` field is `null`
- The turn payload's `owner` field is `null`
- `walkTurnChain(store, legacyTurnHash)` returns a single-element array `[legacyTurnHash]`
- `turnsOfStep(store, legacyTurnHash, anyStepHash)` returns `[]` (owner doesn't match any step)
- The `role` and `content` fields are preserved correctly
