---
"@united-workforce/cli": patch
---

chore(cli): remove unused `_workflowRef` ghost parameter from `resolveActiveThreadStatus`

`resolveActiveThreadStatus` in `packages/cli/src/commands/thread.ts` accepted a
`_workflowRef` argument that was never read inside the body — it only resolves
status from the running marker and the chain reachable from `head`. The dead
parameter (and the matching argument at the three call sites in `cmdThreadShow`,
the thread-list helper, and `cmdThreadResume`) has been dropped. No behavior
change.
