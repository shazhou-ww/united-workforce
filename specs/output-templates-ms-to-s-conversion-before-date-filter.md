---
scenario: "Every Liquid output template that pipes a millisecond field into `| date` first converts it to seconds"
feature: protocol
tags: [output-templates, liquid, date, milliseconds, conversion, regression-guard]
---

## Given
- All output payload schemas in `packages/protocol/src/output-schemas.ts`
  store time-of-event fields as Unix **milliseconds**:
  - `thread-list`: `startedAt`, `completedAt`
  - `step-detail`: `startedAtMs`, `completedAtMs`
  - `step-detail.turns[]`: `timestamp`
- The Liquid `date` filter expects a Unix **seconds** integer (or a parseable
  date string), so a raw millisecond integer overflows year `9999` and
  produces nonsensical years like `58414`
- All Liquid templates live in `packages/protocol/src/output-templates.ts`

## When
- A reviewer (or unit test) inspects every template body in `OUTPUT_TEMPLATES`
  for occurrences of the `| date` filter

## Then
- For every occurrence of the `| date` filter applied to a payload field that
  represents a Unix-ms timestamp, the field MUST first be piped through one of:
  - `| divided_by: 1000` (integer-second result), or
  - `| divided_by: 1000.0` (float-second result), or
  - a registered custom filter named `ms_date` that performs the ms→s conversion
    and date formatting in a single step
- A field is considered a "Unix-ms timestamp" if its schema definition uses
  one of these names: `startedAt`, `completedAt`, `startedAtMs`, `completedAtMs`,
  `timestamp` (within `STEP_DETAIL_TURN`)
- No `| date` invocation in any template directly consumes a raw millisecond
  field without a prior conversion step
- The fix MUST be applied at the protocol-template layer; templates MUST NOT
  rely on per-renderer post-processing to compensate

## Scope

### Confirmed sites that need the conversion (today)
- `THREAD_LIST_TEMPLATE` line containing
  `{{ item.startedAt | date: "%Y-%m-%d %H:%M" }}`

### Sites that MUST stay correct (regression guard)
- Any future template that adds `| date` over a `*Ms`/`startedAt`/`completedAt`/
  `timestamp` field — the same conversion rule applies.
