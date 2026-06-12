---
scenario: "output-mapper for thread list delegates ULID timestamp decoding to @united-workforce/util"
feature: thread
tags: [thread-list, output-mapper, ulid, refactor, dedup]
---

## Given
- `@united-workforce/util` exports `extractUlidTimestamp(ulid)` which uses
  `decodeCrockfordBase32Bits(timestampPart, 48)` to correctly strip the
  2 padding bits from the 10-character timestamp prefix
- Prior to the fix, `packages/cli/src/output-mappers.ts` defined a local
  helper `extractUlidTime` that manually computed `n = n * 32 + v` over the
  first 10 chars, returning the raw 50-bit value (timestamp << 2)
- `toThreadListPayload` populated `startedAt` by calling that local helper

## When
- A reviewer inspects `packages/cli/src/output-mappers.ts` after the fix
- A reviewer runs the existing CLI test suite

## Then
- `packages/cli/src/output-mappers.ts` imports `extractUlidTimestamp` from
  `@united-workforce/util`
- `toThreadListPayload` calls `extractUlidTimestamp(it.thread)` to assign
  the `startedAt` field
- No function named `extractUlidTime` remains in
  `packages/cli/src/output-mappers.ts`
- A vitest test in `packages/cli/src/__tests__/` (named
  `output-mapper-thread-list-startedat.test.ts`) asserts that for a ULID
  generated via `generateUlid(t)`, `toThreadListPayload` returns an item
  whose `startedAt` equals `t` (covering at least one value such as
  `1781219097830`)
- That test asserts `startedAt` is null when the input thread id is not a
  valid 26-char Crockford Base32 ULID (e.g. an empty string or a
  shorter/garbled value)
- `pnpm run test` in `packages/cli` passes
- `pnpm run check` and `pnpm run typecheck` at repo root pass
