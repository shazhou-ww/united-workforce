---
scenario: "StepCompletePayload type captures step completion data"
feature: protocol
tags: [protocol, types, step-complete, turn-chain, phase1]
---

## Given

- The `@united-workforce/protocol` package exports type definitions

## When

- Import `StepCompletePayload` from `@united-workforce/protocol`

## Then

- `StepCompletePayload` is a type with the following fields:
  - `startRef: CasRef` — hash of the corresponding step-start node
  - `output: CasRef` — hash of the agent's output
  - `detail: CasRef` — hash of the step detail node
  - `completedAtMs: number` — Date.now() when step completed
  - `usage: Usage | null` — token usage statistics (null for legacy)
  - `previousAttempts: CasRef[] | null` — hashes of failed attempts (null if no retries)
- All fields are required (no optional `?:` properties)
- The type is compatible with CAS storage (all fields are JSON-serializable)
