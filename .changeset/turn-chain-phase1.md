---
"@united-workforce/protocol": minor
"@united-workforce/cli": minor
---

Add Turn Chain storage layer foundation (Phase 1)

**Protocol Package:**
- Add `StepStartPayload` type for step initiation markers (role, edgePrompt, stepIndex, prev, start, startedAtMs, cwd)
- Add `StepCompletePayload` type for step completion records (startRef, output, detail, completedAtMs, usage, previousAttempts)
- Add `TurnNodePayload` type for turn nodes with prev/owner linking (role, content, prev, owner)
- Add JSON schemas `STEP_START_SCHEMA`, `STEP_COMPLETE_SCHEMA`, `TURN_NODE_SCHEMA` for CAS validation

**CLI Package:**
- Register new schemas in `UwfSchemaHashes` (stepStart, stepComplete, turnNode)
- Add `writeStepStart(store, payload)` to create step-start nodes linked via prev pointer
- Add `writeTurnNode(store, payload)` to create turn nodes with prev/owner linking
- Add `walkTurnChain(store, headHash)` to traverse turn chain in chronological order
- Add `turnsOfStep(store, headHash, stepStartHash)` to filter turns by step ownership
- Support legacy turn nodes (prev/owner = null) without breaking existing data
