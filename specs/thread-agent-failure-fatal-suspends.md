---
scenario: "Fatal agent failure (command crash / unparseable output) transitions thread to suspended"
feature: thread
tags: [agent, failure, suspended, thread-exec, fatal, walkthrough]
---

## Given

- A workflow is registered with at least one role
- A thread is started from this workflow and is in `idle` status
- The agent command will fail fatally: either exit with non-zero code, or produce output that cannot be parsed as valid JSON / StepNode

## When

- `uwf thread exec <thread-id>` is run
- The agent command crashes (non-zero exit code) or produces unparseable output

## Then

- The thread status is set to `suspended` before the process exits
- The thread index entry is persisted via `markThreadSuspended()` with:
  - `suspendedRole` set to the role that was being executed
  - `suspendMessage` containing the failure reason (e.g. "agent command failed (uwf-claude-code): ..." or "agent stdout last line is not valid JSON: ...")
- The thread head is NOT advanced
- `uwf thread list --status suspended` includes this thread
- The CLI process still exits with non-zero exit code (preserving existing behavior for callers that check exit codes)
- `failStep()` no longer calls `process.exit(1)` directly in the agent spawn path; instead the error is caught by `cmdThreadStepOnce` which persists suspend state first
