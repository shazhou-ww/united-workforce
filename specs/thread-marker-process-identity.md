---
scenario: "Running marker records process start time for identity verification"
feature: thread
tags: [background, marker, pid-recycling, walkthrough]
---

## Given
- A thread `T` is idle (no marker exists)

## When
- `uwf thread exec <T>` is invoked (foreground or background)

## Then
- A marker file is created at `~/.uwf/running/<T>.json` containing:
  - `thread`: the thread ID
  - `workflow`: the workflow CAS hash
  - `pid`: the current process PID
  - `startedAt`: current timestamp in milliseconds
  - `processStartTime`: the process start time read from `/proc/<pid>/stat` field 22 (clock ticks since boot)
- On systems where `/proc/<pid>/stat` is unavailable (non-Linux), `processStartTime` is `null`
