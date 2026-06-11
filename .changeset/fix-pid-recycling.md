---
"@united-workforce/cli": patch
---

fix(cli): prevent PID recycling from permanently sticking threads in 'running' state

When a uwf process is killed with SIGKILL and a new unrelated process inherits
the same PID, threads would appear permanently stuck in 'running' state. Now the
running marker records `processStartTime` from `/proc/<pid>/stat` (field 22) and
all marker validation checks (exec, list, stop, cancel) verify both PID aliveness
AND process identity. Stale markers from recycled PIDs are automatically cleaned
up. On non-Linux systems, `processStartTime` is null and the behavior gracefully
falls back to PID-alive-only checks. Fixes #288.
