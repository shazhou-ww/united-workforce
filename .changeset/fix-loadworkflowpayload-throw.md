---
"@united-workforce/cli": patch
---

Fix thread list crash when workflow CAS node is missing or has wrong type

Replace `fail()` (process.exit) with `throw new Error()` in `loadWorkflowPayload` so errors are catchable by the try/catch blocks in `collectActiveThreads` and `collectCompletedThreads`. Threads with missing or invalid workflow references now appear as `corrupt` instead of crashing the entire `uwf thread list` command.
