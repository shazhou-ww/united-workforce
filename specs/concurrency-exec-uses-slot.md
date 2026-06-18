---
scenario: "thread exec acquires concurrency slot before spawning agent and releases after"
feature: thread
tags: [concurrency, exec, integration, walkthrough]
---

## Given
- A thread `T` is in idle state with a valid next step
- `concurrency.maxRunning` is configured as 2 in `~/.uwf/config.yaml`
- 0 active slots exist

## When
- `uwf thread exec <T>` is run

## Then
- Before the agent process is spawned, a slot file is created at `<storageRoot>/slots/<pid>.slot`
- The agent (e.g. `uwf-hermes`) executes normally
- After the agent process exits (success or failure), the slot file is removed
- `countActiveSlots(storageRoot)` returns 0 after exec completes
