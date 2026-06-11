---
"@united-workforce/cli": minor
---

Add `workflowName` field to `thread list` output. Each thread now includes a resolved workflow name from the registry, or `null` when the workflow hash is not in the registry (orphaned thread). Fixes #286.
