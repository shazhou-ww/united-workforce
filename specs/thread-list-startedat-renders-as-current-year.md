---
scenario: "thread list --format text renders startedAt with the calendar year matching the ULID timestamp (not year 58414)"
feature: thread
tags: [thread-list, liquid, template, date, milliseconds, bugfix]
---

## Given
- A thread exists whose `startedAt` field equals `1781229932779`
  (the millisecond Unix timestamp `2026-06-12T05:25:32.779Z`)
- `toThreadListPayload` populates `startedAt` with this **millisecond** value
  (per `THREAD_LIST_OUTPUT_SCHEMA.items.startedAt`, which is documented as a
  Unix-ms integer in `packages/protocol/src/output-schemas.ts`)
- The thread is in `idle` status with `currentRole: planner`,
  workflow hash `WF1234567890A`, and id `01K5HMKZQB7VDA8E2K9P3R5XBC`
- The CLI default format is `text`, dispatched through `writeEnvelope`
  which loads the Liquid template registered for the `thread-list` schema

## When
- User runs `uwf thread list` (or `uwf thread list --format text`)
- The `THREAD_LIST_TEMPLATE` in `packages/protocol/src/output-templates.ts`
  is rendered against the payload by the LiquidJS engine in
  `packages/cli/src/format.ts`

## Then
- The `STARTED` column for this thread MUST display `2026-06-12 05:25`
- Stdout MUST NOT contain the literal substring `58414` (the year produced
  when ms is fed to `| date` as if it were seconds)
- Stdout MUST NOT contain any 5-digit year prefix in the `STARTED` column
  (verifiable via the regex `^\d{5}-\d{2}-\d{2}` over each `STARTED` cell)
- The displayed year MUST be within `[2020, 2099]` for any thread whose
  `startedAt` is a current real-world timestamp
- Exit code is `0`

## Alternative: startedAt is null

### Given
- A thread is listed whose `startedAt` is `null` (e.g. legacy thread without
  a parseable ULID timestamp)

### When
- `uwf thread list --format text` is invoked

### Then
- The `STARTED` column for that row displays the literal `-` (dash)
- No `Invalid Date`, `1970`, or `58414` substring appears for that row
