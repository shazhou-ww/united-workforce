---
scenario: "step turns --role filters by step-start role, preserving all segments of that role"
feature: step
tags: [step-turns, panorama, role-filter, recurring-role, phase-3, issue-409]
---

## Given

- A thread with steps: developer (r1), reviewer, developer (r2), reviewer, developer (r3)
- Step chain has 5 step-starts with roles: dev, rev, dev, rev, dev
- Each step has turns owned by its respective step-start

## When

- Run `uwf step turns <thread-id> --role developer`

## Then

- Output shows 3 groups (all developer segments):
  1. `## developer` with round 1 turns
  2. `## developer` with round 2 turns
  3. `## developer` with round 3 turns
- Reviewer segments are completely omitted
- All developer segments are preserved (not just the first or last)
- Turn counts and content are correct for each segment
- Completed/in-flight markers are correct per segment
