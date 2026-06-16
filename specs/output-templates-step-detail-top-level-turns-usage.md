---
scenario: "STEP_DETAIL_TEMPLATE references top-level turns/usage/durationMs (matching the toStepDetailPayload mapper + @uwf/output/step-detail schema), guarded by a protocol unit test like the #351 ms-date guards"
feature: cli
tags: [protocol, output-templates, liquid, step-detail, turns, usage, regression-guard, "403"]
---

## Background

`packages/protocol/src/output-templates.ts` defines `STEP_DETAIL_TEMPLATE`, the
Liquid template registered under `@ocas/template/text/<step-detail-hash>` and
used by `uwf step show` in the default `text` format. PR #394 added a `Usage`
line and a `Turns` / `--- Content ---` block to this template; the data is
supplied by `toStepDetailPayload` (`packages/cli/src/output-mappers.ts`), which
emits **top-level** `turns` (normalized from `detail.turns`), `usage`, and
`durationMs`. The `@uwf/output/step-detail` schema
(`STEP_DETAIL_OUTPUT_SCHEMA`) `requires` top-level `turns` and `usage`.

There is currently **no test** pinning the template to this top-level shape, so
issue #403's suggested-but-wrong "fix" (retargeting iteration to `detail.turns`)
could be merged without any guard failing. This spec adds a static template
invariant, mirroring the existing `| date` ms→s guards in
`packages/protocol/src/__tests__/output-templates-ms-date.test.ts` (issue #351).

## Given
- `OUTPUT_TEMPLATES["step-detail"]` (the `STEP_DETAIL_TEMPLATE` string) is
  importable from `@united-workforce/protocol`
- The mapper contract: `toStepDetailPayload` produces a payload with top-level
  `turns: Array<{ role, content, timestamp }>`, top-level `usage`, top-level
  `durationMs`, plus a raw `detail` passthrough

## When
- A protocol unit test in
  `packages/protocol/src/__tests__/output-templates-step-detail.test.ts`
  inspects the `step-detail` template string and renders it against a
  representative payload

## Then
- **Static invariant (positive):** the template iterates the **top-level**
  `turns` collection — it contains a `{% for turn in turns %}` loop and a
  `{% if turns and turns.size > 0 %}` guard, and references `{{ turn.role }}`
  and `{{ turn.content }}`. It references top-level `{{ usage.inputTokens }}` /
  `{{ usage.outputTokens }}` / `{{ usage.turns }}` and top-level `durationMs`.
- **Static invariant (negative / anti-regression):** the template does **not**
  iterate `detail.turns` (no `{% for turn in detail.turns %}`) and does **not**
  gate the Content block on `detail.turns` — guarding against the mis-diagnosed
  "fix direction 1" in #403.
- **Render assertion:** rendering the template against a payload with
  `turns: [{ role: "assistant", content: "A" }, { role: "assistant", content:
  "B" }]`, `usage: { inputTokens: 38612, outputTokens: 10584, turns: 9 }`,
  `durationMs: 137400` yields text that contains `--- Content ---`,
  `[assistant] A`, `[assistant] B`, `Turns   2`, and
  `Usage   38612 in / 10584 out / 9 turns`.
- **Empty-turns render assertion:** rendering against `turns: []` (or `turns`
  absent) yields the metadata header with **no** `Turns` line and **no**
  `--- Content ---` block, and does not throw.
- The test passes at HEAD (post-#394 template) and would fail if the template
  were reverted to the pre-#394 5-line form or retargeted to `detail.turns`.
