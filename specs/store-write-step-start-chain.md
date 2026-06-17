---
scenario: "writeStepStart creates step-start nodes linked via prev"
feature: store
tags: [store, step-start, turn-chain, phase1]
---

## Given

- An empty CAS store
- Three step-start payloads:
  - step 0: `{ role: "planner", edgePrompt: "Analyze the issue", stepIndex: 0, prev: null, start: <startRef>, startedAtMs: 1000, cwd: "/repo" }`
  - step 1: `{ role: "developer", edgePrompt: "Implement the fix", stepIndex: 1, prev: <SS0>, start: <startRef>, startedAtMs: 2000, cwd: "/repo" }`
  - step 2: `{ role: "reviewer", edgePrompt: "Review the changes", stepIndex: 2, prev: <SS1>, start: <startRef>, startedAtMs: 3000, cwd: "/repo" }`

## When

- Call `writeStepStart(store, payload)` for each step in order, passing the previous step's hash as `prev`

## Then

- Each call returns a CAS hash (13-char Crockford Base32)
- The returned hashes are distinct
- Each step-start node can be retrieved via `store.cas.get(hash)`
- The retrieved node's payload contains the exact fields passed in
- Walking the chain from SS2 via `prev` yields [SS2, SS1, SS0] (reverse chronological order)
- `stepIndex` values in the chain are 2, 1, 0
- `edgePrompt` values match what was written
