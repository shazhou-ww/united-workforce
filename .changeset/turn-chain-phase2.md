---
"@united-workforce/cli": minor
"@united-workforce/protocol": patch
---

Turn chain Phase 2 (#419): broker-step producer改造 and active var thread-keyed transition

- **Step-start/step-complete dual nodes**: `executeBrokerStep` now writes a step-start node at entry (before broker.send) and clears the active-step var at completion. This enables crash recovery isolation and in-flight step detection.

- **Thread-keyed active vars**: Replaced role-keyed `@uwf/active-turns/<tid>/<role>` with thread-keyed vars:
  - `@uwf/active-step/<tid>`: Current in-flight step-start hash (cleared on completion)
  - `@uwf/active-turn-head/<tid>`: Head of the turn chain (persists after completion)

- **Turn chain with prev+owner**: Each turn node now includes:
  - `prev`: Pointer to previous turn (forms global turn chain)
  - `owner`: Reference to owning step-start (enables filtering by step)

- **Detail node simplified**: Removed `turns` array from detail node. Turns are now self-contained via the prev+owner chain. Use `turnsOfStep(turnHead, stepStartHash)` to retrieve turns for a specific step.

- **#412 regression fix**: Same role appearing in multiple rounds now correctly attributes turns to their respective step-starts via the `owner` field, not role name.

Deprecated functions (will be removed in Phase 3):
- `appendActiveTurn`, `readActiveTurns`, `clearActiveTurns` (role-keyed)
- `readActiveTurnRoles`, `activeTurnsVarName`

New functions:
- `setActiveStep`, `getActiveStep`, `clearActiveStep`
- `setActiveTurnHead`, `getActiveTurnHead`
- `turnsOfStep`, `walkTurnChain`, `writeStepStart`, `writeTurnNode`
