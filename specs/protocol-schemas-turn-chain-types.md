---
scenario: "JSON schemas for step-start, step-complete, and turn nodes are registered"
feature: protocol
tags: [protocol, schemas, turn-chain, phase1]
---

## Given

- The `@united-workforce/protocol` package's `schemas.ts` file
- A CAS store initialized with `registerUwfSchemas(store)`

## When

- Call `registerUwfSchemas(store)` to get the schema hashes

## Then

- The returned `UwfSchemaHashes` includes:
  - `stepStart: Hash` — schema hash for `StepStartPayload`
  - `stepComplete: Hash` — schema hash for `StepCompletePayload`
  - `turnNode: Hash` — schema hash for `TurnNodePayload`
- Each schema can be retrieved via `store.cas.get(schemaHash)`
- The step-start schema validates payloads with `role`, `edgePrompt`, `stepIndex`, `prev`, `start`, `startedAtMs`, `cwd`
- The step-complete schema validates payloads with `startRef`, `output`, `detail`, `completedAtMs`, `usage`, `previousAttempts`
- The turn-node schema validates payloads with `role`, `content`, `prev`, `owner`
- The schemas accept `null` for nullable fields (`prev`, `owner`, `usage`, `previousAttempts`)
