---
scenario: "acquireSlot succeeds immediately when active slots are below maxRunning"
feature: thread
tags: [concurrency, slot, acquire]
---

## Given
- storageRoot is `~/.uwf/`
- The `<storageRoot>/slots/` directory exists (or will be created)
- No slot files currently exist (0 active slots)
- maxRunning is configured as 2

## When
- `acquireSlot(storageRoot, 2)` is called

## Then
- A slot file is created at `<storageRoot>/slots/<pid>.slot` where `<pid>` is the current process PID
- The function returns a `SlotHandle` with a `release()` method
- No blocking/waiting occurs (returns immediately)
- Calling `countActiveSlots(storageRoot)` returns 1
