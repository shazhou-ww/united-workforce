---
scenario: "TurnNodePayload type extends turn with prev and owner"
feature: protocol
tags: [protocol, types, turn-chain, phase1]
---

## Given

- The `@united-workforce/protocol` package exports type definitions

## When

- Import `TurnNodePayload` from `@united-workforce/protocol`

## Then

- `TurnNodePayload` is a type with the following fields:
  - `role: string` — "assistant" (or other role identifier)
  - `content: string` — the turn content
  - `prev: CasRef | null` — hash of the previous turn (null for first turn)
  - `owner: CasRef | null` — hash of the owning step-start (null for legacy)
- All fields are required (no optional `?:` properties)
- The type supports legacy turn nodes where `prev` and `owner` are null
- The type is compatible with CAS storage (all fields are JSON-serializable)
