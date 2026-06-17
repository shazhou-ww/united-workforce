---
scenario: "buildTurnsPanorama handles recurring role with in-flight correctly (#412 root cause)"
feature: step
tags: [step-turns, panorama, owner, recurring-role, in-flight, issue-412, phase-3]
---

## Given

- A thread with 3 steps: developer (round 1), reviewer, developer (round 2 in-flight)
- Step chain: ss_dev2 -> ss_rev -> ss_dev1 (via prev pointers)
- Turn mapping:
  - ss_dev1: t1, t2 (round 1 developer, completed)
  - ss_rev: t3, t4 (reviewer, completed)
  - ss_dev2: t5, t6, t7 (round 2 developer, in-flight)
- `@uwf/active-step/<thread>` points to ss_dev2 (in-flight)
- No step-complete exists for ss_dev2
- `@uwf/active-turn-head/<thread>` points to t7

## When

- Run `uwf step turns <thread-id>`

## Then

- Output shows 3 groups in chronological order:
  1. `## developer ✓` with turns t1, t2 (round 1, completed)
  2. `## reviewer ✓` with turns t3, t4 (completed)
  3. `## developer 🔄 进行中` with turns t5, t6, t7 (round 2, in-flight)
- Round 1 developer is NOT marked as in-flight (has step-complete)
- Round 2 developer IS marked as in-flight (active-step points to it, no step-complete)
- Each developer segment contains only its own turns (t1,t2 vs t5,t6,t7)
- Turns are not dropped or mixed between segments
