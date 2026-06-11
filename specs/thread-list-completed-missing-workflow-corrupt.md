---
scenario: "thread list --all shows completed threads even when workflow CAS node is missing"
feature: thread
tags: [thread-list, error-handling, history]
---

## Given

- A completed thread exists in the history index referencing a workflow CAS hash
- The workflow CAS node for that hash has been deleted from the store
- The thread's head step node still exists and contains the workflow ref

## When

- `uwf thread list --all` is invoked

## Then

- The command does NOT crash with a non-zero exit code
- The completed thread appears with its stored status (e.g. `"end"` or `"cancelled"`) — NOT marked as corrupt
- The `workflowName` field is null (since the registry lookup may not resolve the missing workflow)
- No warning is emitted to stderr for this thread
- Other valid threads (active and completed) are still displayed correctly

## Notes

`collectCompletedThreads` only calls `resolveWorkflowFromHead` to extract the workflow CAS ref from the step chain — it does not call `loadWorkflowPayload` to load the full workflow node. Therefore a missing workflow CAS node does not trigger the catch block for completed threads. This is acceptable because completed threads don't need the workflow payload for display purposes.
