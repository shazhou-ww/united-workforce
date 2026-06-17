---
scenario: "Step execution writes step-start on entry and step-complete on exit"
feature: broker-step
tags: [broker-step, step-start, step-complete, turn-chain, phase2]
---

## Given

- An in-memory UwfStore with Phase 1/2 schemas registered
- A thread with ID `tid_test` and a StartNode at `<start_ref>`
- A mock broker configured to return a single turn: `{ content: "Output", hash: "h1" }`
- No prior steps in the thread (prevHash is null)

## When

- Call `executeBrokerStep` with:
  - `threadId: "tid_test"`
  - `role: "planner"`
  - `edgePrompt: "Analyze the issue"`
  - `startHash: <start_ref>`
  - `prevHash: null`
  - `stepIndex: 0`

## Then

**At step start (before broker.send):**
- A step-start node is written to CAS with:
  - `role: "planner"`
  - `edgePrompt: "Analyze the issue"`
  - `stepIndex: 0`
  - `prev: null` (first step)
  - `start: <start_ref>`
  - `startedAtMs: <current timestamp>`
  - `cwd: <effective cwd>`
- The `@uwf/active-step/<tid_test>` var is set to `<SS0>` (the step-start hash)

**At step completion (after broker.send returns):**
- A step-complete node is written to CAS with:
  - `startRef: <SS0>` (points back to the step-start)
  - `output: <output_hash>` (the extracted frontmatter output)
  - `detail: <detail_hash>` (the detail node)
  - `completedAtMs: <current timestamp>`
  - `usage: <usage | null>`
  - `previousAttempts: null`
- The `@uwf/active-step/<tid_test>` var is cleared (step no longer in-flight)
- The thread head is advanced to point to the step-complete node

**Data integrity:**
- `step-complete.startRef` equals the step-start hash written earlier
- The step-start and step-complete form a matched pair
