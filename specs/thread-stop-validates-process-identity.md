---
scenario: "thread stop refuses to send SIGTERM when marker PID is a recycled process"
feature: thread
tags: [background, marker, pid-recycling, safety]
---

## Given
- Thread `T` has a marker with `pid=P` and `processStartTime=100`
- Process `P` is alive but its actual start time is `200` (PID was recycled — different process)

## When
- `uwf thread stop <T>`

## Then
- No signal is sent to process `P` (the innocent unrelated process is NOT killed)
- The stale marker is deleted
- A warning is written to stderr: thread was not actually running (stale marker cleaned up)
- Output indicates `stopped: false`
