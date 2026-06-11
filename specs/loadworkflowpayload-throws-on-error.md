---
scenario: "loadWorkflowPayload throws Error instead of calling process.exit"
feature: thread
tags: [internal, error-handling, refactor]
---

## Given

- `loadWorkflowPayload` is called with a CAS ref that does not exist in the store

## When

- The function attempts to load the workflow node

## Then

- The function throws an `Error` with message `workflow CAS node not found: <ref>`
- It does NOT call `process.exit(1)`
- The thrown error is catchable by standard try/catch blocks in callers like `collectActiveThreads` and `collectCompletedThreads`

---

## Given

- `loadWorkflowPayload` is called with a CAS ref that exists but has a type not matching the Workflow schema

## When

- The function checks the node type

## Then

- The function throws an `Error` with message `node <ref> is not a Workflow`
- It does NOT call `process.exit(1)`
- The thrown error is catchable by standard try/catch blocks
