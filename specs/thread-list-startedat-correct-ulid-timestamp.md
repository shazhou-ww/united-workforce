---
scenario: "thread list startedAt reflects the ULID-encoded creation time (no padding-bits leak)"
feature: thread
tags: [thread-list, output-mapper, ulid, timestamp, bugfix, walkthrough]
---

## Given
- A thread exists whose ULID encodes the timestamp `1781219097830` ms
  (Unix ms for `2026-06-11T23:04:57.830Z`)
- The thread's ULID begins with the 10 Crockford Base32 characters
  produced by `generateUlid(1781219097830)` from `@united-workforce/util`
- The first 10 characters of a ULID encode `48 bits` of timestamp shifted
  left by `2` padding bits to fill `50` bits of Base32 output (per
  `encodeCrockfordBase32Bits` in `@united-workforce/util`)

## When
- `uwf thread list --format json` is invoked
- The CLI calls `toThreadListPayload` in `packages/cli/src/output-mappers.ts`
  to build each item

## Then
- The returned item's `startedAt` field equals `1781219097830` (the original
  Unix-ms timestamp passed to `generateUlid`), NOT `7124876391323`
  (the raw 50-bit value that includes 2 padding bits)
- The value, divided by `1000` and rendered as a date, yields `2026-06-11`
  (and NOT `2195-10-11` or any year far in the future)
- `toThreadListPayload` obtains the timestamp via
  `extractUlidTimestamp` imported from `@united-workforce/util`
- The legacy local helper `extractUlidTime` is no longer defined in
  `packages/cli/src/output-mappers.ts`
