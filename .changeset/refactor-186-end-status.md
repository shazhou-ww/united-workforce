---
"@united-workforce/protocol": major
"@united-workforce/cli": major
"@united-workforce/util": patch
---

refactor: rename ThreadStatus "completed" → "end" (#186)

**Breaking:** `ThreadStatus` no longer includes `"completed"`. The terminal status for threads that reach `$END` is now `"end"`.

- `ThreadStatus` union: `"idle" | "running" | "suspended" | "end" | "cancelled"`
- `completeThread()` and `markThreadCompleted()` now accept `"end" | "cancelled"` (was `"completed" | "cancelled"`)
- `--status completed` CLI filter is replaced by `--status end`
- Legacy on-disk data with `status: "completed"` is silently normalized to `"end"` on read

**Why:** `$END` is a neutral terminal state — success, failure, or guard-blocked all route there. "completed" misleadingly implies success. "end" is neutral and matches the `$END` pseudo-role name.
