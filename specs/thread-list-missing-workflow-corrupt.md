---
scenario: "thread list marks threads with missing workflow CAS nodes as corrupt"
feature: thread
tags: [thread-list, error-handling, corrupt]
---

## Given

- A thread exists in the active index referencing a workflow CAS hash
- The workflow CAS node for that hash has been deleted from the store (e.g. after CAS cleanup or migration)

## When

- `uwf thread list` is invoked

## Then

- The command does NOT crash with a non-zero exit code
- The thread with the missing workflow appears in the output with `status: "corrupt"` and `statusDisplay: "corrupt"`
- A warning is written to stderr: `warning: thread <threadId> is corrupt: workflow CAS node not found: <hash>`
- Other valid threads in the list are still displayed correctly
