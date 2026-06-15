---
scenario: "thread list marks threads whose workflow ref points to a non-Workflow node as corrupt"
feature: thread
tags: [thread-list, error-handling, corrupt]
---

## Given

- A thread exists in the active index referencing a CAS hash
- The CAS node at that hash exists but its type does not match the Workflow schema hash

## When

- `uwf thread list` is invoked

## Then

- The command does NOT crash with a non-zero exit code
- The thread appears in the output with `status: "corrupt"` and `statusDisplay: "corrupt"`
- A warning is written to stderr: `warning: thread <threadId> is corrupt: node <hash> is not a Workflow`
- Other valid threads in the list are still displayed correctly
