---
scenario: "step turns --limit/--offset paginates on flattened cross-step turn sequence"
feature: step
tags: [step-turns, panorama, pagination, limit, offset, phase-3, issue-409]
---

## Given

- A thread with 3 steps, each having 4 turns (12 turns total)
- Flattened turn sequence: t0..t11 (global indices 0-11)
- Turn distribution: step0 (t0-t3), step1 (t4-t7), step2 (t8-t11)

## When

- Run `uwf step turns <thread-id> --offset 5 --limit 4`

## Then

- Output shows turns with global indices 5, 6, 7, 8
- Pagination crosses step boundaries correctly:
  - Step 1 group shows turns t5, t6, t7 (indices 5-7)
  - Step 2 group shows turn t8 (index 8)
- Turn numbering in output reflects global index (Turn 6, Turn 7, Turn 8, Turn 9 in 1-based)
- Groups with no surviving turns after pagination still show their header
- Total turn count in headers is unaffected by pagination (shows original count)
