---
scenario: "buildTurnsPanorama detects in-flight step via active-step var and missing step-complete"
feature: step
tags: [step-turns, panorama, in-flight, active-step, step-complete, phase-3]
---

## Given

- A thread with 2 steps:
  - Step 1: has step-start (ss1) and step-complete (completed)
  - Step 2: has step-start (ss2) but no step-complete (in-flight)
- `@uwf/active-step/<thread>` points to ss2
- `@uwf/active-turn-head/<thread>` points to latest turn of ss2

## When

- Run `uwf step turns <thread-id>`

## Then

- Step 1 is marked `✓` (has step-complete, regardless of active-step)
- Step 2 is marked `🔄 进行中` (active-step points to ss2 AND no step-complete for ss2)
- In-flight detection uses:
  1. Check if step-start hash matches active-step var
  2. Check if step-complete exists for that step-start
  3. Only mark in-flight if (1) is true AND (2) is false
