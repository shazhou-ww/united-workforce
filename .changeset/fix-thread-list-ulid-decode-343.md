---
"@united-workforce/cli": patch
---

Fix `uwf thread list` startedAt timestamp showing dates far in the future
(e.g. year 2195 for threads created in 2026). The local `extractUlidTime`
helper in `packages/cli/src/output-mappers.ts` manually decoded the first
10 Crockford Base32 chars of a ULID as `n = n * 32 + v`, returning the
raw 50-bit value without stripping the 2 padding bits introduced by
`encodeCrockfordBase32Bits`. This produced timestamps 4× the real value.

The helper has been removed in favor of `extractUlidTimestamp` from
`@united-workforce/util`, which delegates to
`decodeCrockfordBase32Bits(timestampPart, 48)` and handles padding
correctly. A new unit test
(`packages/cli/src/__tests__/output-mapper-thread-list-startedat.test.ts`)
covers the round-trip across several timestamps and the
malformed-ULID-null fallback.

Fixes #343.
