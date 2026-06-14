---
scenario: "Recoverable agent failure (isError: true) transitions thread to suspended"
feature: thread
tags: [agent, failure, suspended, thread-exec]
---

## Given

- A workflow is registered with at least one role
- A thread is started from this workflow and is in `idle` status
- The agent command runs and produces a StepNode in CAS but reports `isError: true` (e.g. frontmatter validation exhausted retries)

## When

- `uwf thread exec <thread-id>` is run
- The agent returns `{ stepHash: "<hash>", isError: true, errorMessage: "agent reported error" }`

## Then

- The CLI output has `status: "suspended"` (not `"idle"`)
- The CLI output has `suspendedRole` set to the role that failed (not `null`)
- The CLI output has `suspendMessage` set to the agent's error message (not `null`)
- The thread head is NOT advanced (remains at the previous head)
- The thread index entry in the variable store is updated via `markThreadSuspended()` so the suspended state is persisted
- `uwf thread list --status suspended` includes this thread
- The `error` field in StepOutput still contains `{ stepHash, message }` for backward compatibility
