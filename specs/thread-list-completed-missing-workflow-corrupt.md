---
scenario: "thread list marks completed threads with missing workflow CAS nodes as corrupt"
feature: thread
tags: [thread-list, error-handling, corrupt, history]
---

## Given

- A completed thread exists in the history index referencing a workflow CAS hash
- The workflow CAS node for that hash has been deleted from the store
- `uwf thread list --all` is invoked to include completed threads

## When

- `uwf thread list --all` is invoked

## Then

- The command does NOT crash with a non-zero exit code
- The completed thread with the missing workflow appears with `status: "corrupt"` and `statusDisplay: "corrupt"`
- A warning is written to stderr: `warning: completed thread <threadId> is corrupt: workflow CAS node not found: <hash>`
- Other valid threads (active and completed) are still displayed correctly
