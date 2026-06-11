---
"@united-workforce/cli": minor
---

Add step-level concurrency control for `uwf thread exec`

- New `concurrency/` module with file-based slot management (`acquireSlot`, `releaseSlot`, `countActiveSlots`, `cleanStaleSlots`, `installSlotCleanup`)
- `--max-concurrent <n>` flag on `uwf thread exec` to override the concurrency limit per invocation
- `concurrency.maxRunning` config key for persistent limit (`uwf config set concurrency.maxRunning <n>`)
- Default limit: 2 concurrent agent processes (when no config or flag provided)
- Race protection via double-check-after-write with automatic rollback
- Signal handlers (SIGINT/SIGTERM) release the slot on abnormal exit
- Stale slot cleanup: detects dead PIDs and removes orphaned slot files
