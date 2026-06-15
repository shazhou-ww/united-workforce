---
scenario: "thread exec auto-recovers when marker PID belongs to a recycled process"
feature: thread
tags: [background, marker, pid-recycling, stale-recovery]
---

## Given
- A thread `T` is in idle state (not actually executing)
- A stale marker file exists at `~/.uwf/running/<T>.json` with:
  - `pid` pointing to a live process that is NOT a uwf process (simulates PID recycling)
  - `processStartTime` that does NOT match the live process's actual start time
- The marker was left behind because the original uwf process was killed with SIGKILL

## When
- `uwf thread exec <T>`

## Then
- The stale marker is automatically deleted (recovered)
- The thread executes normally (moderator -> agent -> extract cycle proceeds)
- No error message about "already being executed by PID ..." is shown
