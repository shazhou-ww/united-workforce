---
scenario: "acquireSlot blocks when active slots equal maxRunning, proceeds after release"
feature: thread
tags: [concurrency, slot, blocking]
---

## Given
- storageRoot is `~/.uwf/`
- maxRunning is 1
- One slot file already exists at `<storageRoot>/slots/<other-pid>.slot` for a live process
- `countActiveSlots(storageRoot)` returns 1

## When
- `acquireSlot(storageRoot, 1, onWaiting, onAcquired)` is called from a second process

## Then
- The `onWaiting` callback is invoked with current/max info (e.g. "1/1 running")
- The function polls with ~2s interval (does not return immediately)
- When the existing slot is released (file removed), the function:
  - Creates `<storageRoot>/slots/<pid>.slot` for the waiting process
  - Calls the `onAcquired` callback
  - Returns a `SlotHandle`
