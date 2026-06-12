---
scenario: "THREAD_LIST_TEMPLATE divides item.startedAt by 1000 before piping to `| date`"
feature: protocol
tags: [output-templates, thread-list, liquid, date, divided_by, bugfix]
---

## Given
- `packages/protocol/src/output-templates.ts` exports
  `OUTPUT_TEMPLATES["thread-list"]` (the `THREAD_LIST_TEMPLATE` constant)
- `THREAD_LIST_OUTPUT_SCHEMA.items.startedAt` is documented as a Unix-ms
  integer (or `null`)

## When
- The template source is read at module-load time

## Then
- The template body MUST contain a substring equivalent to
  `{{ item.startedAt | divided_by: 1000 | date: "%Y-%m-%d %H:%M" }}`
  (whitespace inside the `{{ … }}` block is not significant)
- The template body MUST NOT contain the substring
  `{{ item.startedAt | date:` without an intervening `divided_by`
- The template MUST still guard the `null` case via
  `{% if item.startedAt %}…{% else %}-{% endif %}`
  so that a `null`/`0`/falsy `startedAt` renders as `-`

## Alternative: custom `ms_date` filter approach

### Given
- The fix is implemented by registering a custom Liquid filter named
  `ms_date` in `packages/cli/src/format.ts` instead of using `divided_by`

### When
- `getLiquidEngine()` is invoked

### Then
- The returned engine has a registered filter named `ms_date` that:
  - Accepts an integer (Unix ms) and a `strftime`-style format string
  - Returns the same string that
    `{{ value | divided_by: 1000 | date: format }}` would produce
  - Returns the empty string (or the literal `-`, matching the existing
    `THREAD_LIST_TEMPLATE` else branch) for `null`/`undefined`/non-numeric input
- `THREAD_LIST_TEMPLATE` then uses
  `{{ item.startedAt | ms_date: "%Y-%m-%d %H:%M" }}`
  in place of the prior `| date` invocation

## Test Hooks

### Given
- A unit test imports `OUTPUT_TEMPLATES` from `@united-workforce/protocol`

### When
- The test renders `OUTPUT_TEMPLATES["thread-list"]` against
  `{ items: [{ threadId: "01K5HMKZQB7VDA8E2K9P3R5XBC",
                workflowHash: "WF1234567890A", workflowName: null,
                status: "idle", currentRole: "planner",
                startedAt: 1781229932779, completedAt: null }] }`
  using the same LiquidJS engine constructed by `getLiquidEngine()`
  (or the equivalent in-test engine)

### Then
- The rendered output contains `2026-06-12` (or the date corresponding to the
  ms value in the test's local timezone)
- The rendered output does NOT contain `58414`
- The test asserts the year segment matches `/^20\d{2}-/` for the date column
