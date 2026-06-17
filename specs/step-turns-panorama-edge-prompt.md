---
scenario: "buildTurnsPanorama can display edgePrompt from step-start"
feature: step
tags: [step-turns, panorama, edge-prompt, step-start, phase-3]
---

## Given

- A thread with 2 steps, each step-start has edgePrompt:
  - Step 1 (planner): edgePrompt = "Initial prompt from user"
  - Step 2 (developer): edgePrompt = "Implement the plan from planner"

## When

- Run `uwf step turns <thread-id>` (or with appropriate flag to show edge prompts)

## Then

- Each step group can display its edgePrompt (the trigger context for that step)
- edgePrompt is read directly from step-start.edgePrompt
- No need to look up StepNode or other structures for edge prompt
- Format: edgePrompt appears as metadata for the step group (exact UI TBD)
