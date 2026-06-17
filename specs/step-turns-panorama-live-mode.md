---
scenario: "step turns --live follows active-turn-head growth in real-time"
feature: step
tags: [step-turns, panorama, live, realtime, active-turn-head, phase-3, issue-409]
---

## Given

- A thread with an in-flight step (active-step var set)
- Initial state: active-turn-head points to t3 (3 turns so far)
- Agent continues producing turns: t4, t5 arrive during observation

## When

- Run `uwf step turns <thread-id> --live`

## Then

- Initial output shows the in-flight step with 3 turns
- As new turns are written to CAS and active-turn-head updated:
  - Output refreshes to show 4 turns, then 5 turns
- Completed steps remain unchanged (read from step-complete)
- In-flight group updates its turn count and content in real-time
- Group header updates: `## role 🔄 进行中 (3 turns so far)` -> `(5 turns so far)`
