---
scenario: "StepStartPayload type captures step initiation data"
feature: protocol
tags: [protocol, types, step-start, turn-chain, phase1]
---

## Given

- The `@united-workforce/protocol` package exports type definitions

## When

- Import `StepStartPayload` from `@united-workforce/protocol`

## Then

- `StepStartPayload` is a type with the following fields:
  - `role: string` — the role name executing this step
  - `edgePrompt: string` — moderator edge prompt that led to this step
  - `stepIndex: number` — 0-based index of this step in the thread
  - `prev: CasRef | null` — hash of the previous step-start (null for first step)
  - `start: CasRef` — hash of the thread's StartNode
  - `startedAtMs: number` — Date.now() when step began
  - `cwd: string` — working directory where the agent executes
- All fields are required (no optional `?:` properties)
- The type is compatible with CAS storage (all fields are JSON-serializable)
