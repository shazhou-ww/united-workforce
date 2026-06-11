---
scenario: "slot is released when exec process receives SIGINT or SIGTERM"
feature: thread
tags: [concurrency, slot, signal, cleanup]
---

## Given
- A thread `T` is executing (agent is running)
- A slot file exists at `<storageRoot>/slots/<pid>.slot`
- Signal cleanup handlers are installed via `installSlotCleanup(handle)`

## When
- The `uwf thread exec` process receives SIGINT (Ctrl+C) or SIGTERM

## Then
- The cleanup handler removes the slot file before process exit
- `countActiveSlots(storageRoot)` no longer counts this process
- Other waiting exec processes can now acquire the freed slot
