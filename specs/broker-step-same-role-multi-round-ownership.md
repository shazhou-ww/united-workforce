---
scenario: "Same role multiple rounds — each round's turns have correct owner (#412 regression)"
feature: broker-step
tags: [broker-step, turn-chain, owner, multi-round, regression, phase2]
---

## Given

- An in-memory UwfStore with Phase 2 schemas registered
- A thread with ID `tid_test`
- A workflow with role cycle: `developer → reviewer → developer` (developer appears twice)
- Three step executions seed the thread:
  1. **Round 1 developer (completed):** step-start `SS_dev1`, 2 turns (T1, T2) with `owner: SS_dev1`
  2. **Reviewer (completed):** step-start `SS_rev`, 2 turns (T3, T4) with `owner: SS_rev`
  3. **Round 2 developer (in-flight):** step-start `SS_dev2`, 1 turn (T5) with `owner: SS_dev2`

## When

- Query the turn chain from the active-turn-head `T5`
- Check ownership of each turn via `turn.owner`
- Check if round 1 developer step is marked as completed vs in-flight
- Check `@uwf/active-step/<tid_test>` var value

## Then

**Turn ownership is correct:**
- T1.owner == `SS_dev1` (round 1 developer)
- T2.owner == `SS_dev1` (round 1 developer)
- T3.owner == `SS_rev` (reviewer)
- T4.owner == `SS_rev` (reviewer)
- T5.owner == `SS_dev2` (round 2 developer)

**Step-start chain is correct:**
- SS_dev2.prev == SS_rev
- SS_rev.prev == SS_dev1
- SS_dev1.prev == null

**In-flight detection:**
- `@uwf/active-step/<tid_test>` points to `SS_dev2` (the current in-flight step)
- Round 1 developer step (`SS_dev1`) has a corresponding step-complete node → NOT in-flight
- Round 2 developer step (`SS_dev2`) has NO step-complete node yet → IS in-flight

**#412 root cause fixed:**
- When building panorama, round 1's turns (T1, T2) are NOT incorrectly attributed to round 2
- Round 1's step is NOT marked "🔄 进行中" (in-flight flag comes from active-step var, not role name)
- Active var is keyed by thread only (`@uwf/active-step/<tid>`) — NOT by `(thread, role)`
