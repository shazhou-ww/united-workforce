---
"@united-workforce/cli": patch
---

Fix: agent step failure now transitions thread to suspended instead of idle

When an agent step fails (either recoverable `isError: true` or fatal command crash),
the thread now enters `suspended` status with `suspendedRole` and `suspendMessage` set,
making failures visible to supervisors via `uwf thread list --status suspended`.

Previously, agent failures left the thread in `idle` status, hiding the failure.
Threads suspended by agent failure can be resumed with `uwf thread resume -p "..."`.
