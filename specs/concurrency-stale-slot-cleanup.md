---
scenario: "cleanStaleSlots removes slot files for dead PIDs"
feature: thread
tags: [concurrency, slot, stale, cleanup]
---

## Given
- storageRoot is `~/.uwf/`
- `<storageRoot>/slots/` contains:
  - `12345.slot` where PID 12345 is no longer running (dead process)
  - `<current-pid>.slot` for a live process
- `countActiveSlots(storageRoot)` would return 2 without cleanup

## When
- `cleanStaleSlots(storageRoot)` is called

## Then
- The file `12345.slot` is removed (dead PID detected via `process.kill(pid, 0)`)
- The file `<current-pid>.slot` is preserved (live process)
- Returns 1 (number of stale slots cleaned)
- `countActiveSlots(storageRoot)` now returns 1
