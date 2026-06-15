---
scenario: "thread exec is blocked when marker PID and process start time both match"
feature: thread
tags: [background, marker, pid-recycling]
---

## Given
- Thread `T` has a marker with `pid=P` and `processStartTime=100`
- Process `P` is alive and its actual start time from `/proc/P/stat` is `100` (same process)

## When
- `uwf thread exec <T>`

## Then
- The thread does NOT execute
- Error message: "thread <T> is already being executed by PID P"
- Exit code is non-zero
