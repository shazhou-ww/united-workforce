---
scenario: "thread cancel refuses to send SIGTERM when marker PID is a recycled process"
feature: thread
tags: [background, marker, pid-recycling, safety, walkthrough]
---

## Given
- Thread `T` has a marker with `pid=P` and `processStartTime=100`
- Process `P` is alive but its actual start time is `200` (PID was recycled — different process)

## When
- `uwf thread cancel <T>`

## Then
- No signal is sent to process `P` (the innocent unrelated process is NOT killed)
- The stale marker is deleted
- The thread is moved to history with status "cancelled" (cancellation proceeds normally)
