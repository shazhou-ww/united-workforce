---
scenario: "thread list filters out markers with mismatched process start time"
feature: thread
tags: [background, marker, pid-recycling, stale-recovery]
---

## Given
- Thread `T1` has a marker with `pid=P` and `processStartTime=100`
- Process `P` is alive but its actual start time (from `/proc/P/stat`) is `200` (different process)
- Thread `T2` has a marker with `pid=Q` and `processStartTime=300`
- Process `Q` is alive and its actual start time matches `300` (same process)

## When
- `uwf thread list --status running`

## Then
- `T1` is NOT listed as running (marker is stale due to PID recycling)
- `T1`'s marker file is automatically deleted
- `T2` IS listed as running (marker is valid, process identity confirmed)
