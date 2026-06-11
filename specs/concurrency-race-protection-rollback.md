---
scenario: "acquireSlot rolls back slot file if post-write count exceeds maxRunning"
feature: thread
tags: [concurrency, slot, race-condition]
---

## Given
- storageRoot is `~/.uwf/`
- maxRunning is 2
- 1 active slot exists
- Two processes attempt `acquireSlot` simultaneously (race condition)

## When
- Both processes write their slot files nearly simultaneously
- After writing, process B double-checks `countActiveSlots` and finds 3 (exceeds maxRunning)

## Then
- Process B removes its own slot file (rollback)
- Process B enters the polling wait loop
- Process A's slot remains valid (it won the race)
- Eventually process B retries and succeeds when a slot opens
