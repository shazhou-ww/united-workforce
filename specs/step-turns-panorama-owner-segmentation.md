---
scenario: "buildTurnsPanorama segments turns by step-start owner"
feature: step
tags: [step-turns, panorama, owner, turn-chain, phase-3]
---

## Given

- A thread with 3 completed steps: step0 (planner), step1 (developer), step2 (reviewer)
- Each step has 2 turns with owner pointing to its step-start hash
- Turn chain: t0 -> t1 -> t2 -> t3 -> t4 -> t5 (6 turns total)
- Owner mapping: t0,t1 -> ss0 ; t2,t3 -> ss1 ; t4,t5 -> ss2
- Step chain: ss2 -> ss1 -> ss0 (via prev pointers)
- No in-flight step (all completed)

## When

- Run `uwf step turns <thread-id>`

## Then

- Output shows 3 groups in step-chain order (ss0, ss1, ss2)
- Each group shows only turns with matching owner:
  - Group 0 (planner): turns t0, t1 only
  - Group 1 (developer): turns t2, t3 only
  - Group 2 (reviewer): turns t4, t5 only
- No turns appear in multiple groups (no cross-segment leakage)
- Each group is marked with `✓` (completed)
