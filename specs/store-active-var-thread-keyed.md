---
scenario: "Active vars transition from role-keyed to thread-keyed"
feature: store
tags: [store, active-var, turn-chain, phase2]
---

## Given

- An in-memory UwfStore with Phase 2 schemas registered
- A thread with ID `tid_test`

## When

- Execute a step for role "developer" that produces 2 turns
- Check the variable namespace for `@uwf/active-*` patterns

## Then

**New thread-level vars exist:**
- `@uwf/active-step/<tid_test>` — points to the current step-start hash (while in-flight), cleared on completion
- `@uwf/active-turn-head/<tid_test>` — points to the most recent turn hash (the chain head)

**Old role-keyed vars are NOT used:**
- `@uwf/active-turns/<tid_test>/developer` does NOT exist
- `@uwf/active-turns/<tid_test>/<any-role>` does NOT exist
- No variable with pattern `@uwf/active-turns/<tid>/<role>` is created

**Var lifecycle:**
- At step start: `@uwf/active-step/<tid>` is set to the new step-start hash
- During step: `@uwf/active-turn-head/<tid>` advances with each turn
- At step completion: `@uwf/active-step/<tid>` is cleared; `@uwf/active-turn-head/<tid>` remains (turns are immutable)

**Crash recovery:**
- A new attempt creates a NEW step-start (new hash)
- The old attempt's turns remain in CAS with `owner` pointing to the OLD step-start
- The new attempt's turns get a fresh chain with `owner` pointing to the NEW step-start
- No cross-contamination between attempts
