---
scenario: "Crash recovery writes new step-start isolating old attempt's turns"
feature: broker-step
tags: [broker-step, crash-recovery, step-start, turn-chain, phase2]
---

## Given

- An in-memory UwfStore with Phase 2 schemas registered
- A thread with ID `tid_test` that experienced a crash mid-step
- **Before crash (attempt 1):**
  - Step-start `SS1` written for role "developer"
  - Turns T1, T2 written with `owner: SS1`
  - `@uwf/active-step/<tid_test>` points to `SS1`
  - `@uwf/active-turn-head/<tid_test>` points to T2
  - No step-complete written (process died)

## When

- Restart and re-run the step for role "developer" (attempt 2)
- `executeBrokerStep` is called with the same `(threadId, role)` but fresh state

## Then

**New attempt gets a new step-start:**
- A NEW step-start `SS2` is written (different hash from SS1)
- `SS2.prev` points to the PREVIOUS completed step (or null), NOT to SS1
- `SS2.startedAtMs` is the new timestamp
- `@uwf/active-step/<tid_test>` is updated to `SS2`

**Old attempt's turns are orphaned (not mixed in):**
- T1, T2 remain in CAS with `owner: SS1`
- They are NOT linked to SS2
- `turnsOfStep(turnHead, SS2)` returns [] initially (no turns for new attempt yet)
- `turnsOfStep(turnHead, SS1)` would return [T1, T2] (but SS1 has no step-complete)

**New attempt's turn chain:**
- The first turn T3 in the new attempt has:
  - `prev: null` (fresh chain start for this step, NOT pointing to T2)
  - `owner: SS2`
- Actually, if there's a global turn head, prev points to the previous turn in the global chain
- Correction: `prev` links the global turn chain; `owner` separates attempts
- T3.prev would point to the previous turn (could be T2), BUT T3.owner == SS2

**Natural isolation:**
- The new step-start SS2 has a different hash than SS1
- All turns from attempt 2 have `owner: SS2`
- All turns from attempt 1 have `owner: SS1`
- Querying `turnsOfStep(head, SS2)` only returns attempt 2's turns
- Querying `turnsOfStep(head, SS1)` only returns attempt 1's turns (orphaned)
