---
scenario: "uwf step show <hash> in text format renders the --- Content --- block with each turn's role and content, driven by the mapper-flattened top-level turns (regression guard for the #394-introduced render path)"
feature: step
tags: [cli, step-show, text-renderer, liquid, output-mappers, turns, regression, "403", "394"]
---

## Background — root cause is NOT what issue #403 claims

Issue #403 reports that `uwf step show <hash>` in **text** format prints only
metadata (`Step` / `Role` / `Agent` / `Status` / `Duration`) and omits the
`--- Content ---` turn block, while `--format json` still carries the turns.

The issue hypothesizes that PR #394 "forgot to update the text template" and
that `STEP_DETAIL_TEMPLATE` still references an undefined top-level `turns`.
**That diagnosis is incorrect and must not be implemented** (its "fix direction
1" — retargeting the template to `detail.turns` — would regress the working
data path). Ground truth, verified against `origin/main` (HEAD includes #394 at
`63d03e1`):

1. PR #394 **did** add the `--- Content ---` block to `STEP_DETAIL_TEMPLATE`
   (`packages/protocol/src/output-templates.ts:32-41`), referencing **top-level**
   `turns`, `usage`, `durationMs`.
2. `uwf step show` does **not** feed `cmdStepShow`'s raw return to the template.
   `cli.ts` (the `step show` action) wraps it through
   `toStepDetailPayload(stepHash, detail)` (`packages/cli/src/output-mappers.ts:203`)
   before `writeOutput` → `writeEnvelope` → `renderEnvelopeText`. That mapper
   **flattens** `detail.turns` into a **normalized top-level** `turns` array
   (`output-mappers.ts:206,223` — each turn `{ role, content, timestamp }`) and
   also keeps the raw `detail` passthrough. So at render time top-level `turns`
   **is populated**, not undefined.
3. `usage` is likewise correctly top-level in both `cmdStepShow`'s return
   (`step.ts:247`) and the mapper (`output-mappers.ts:212`); it is **not**
   mis-nested. The issue's worry about `usage` being "同样错位" does not hold.
4. The reproduction in the issue was observed via the **installed global
   `uwf@0.7.0`**, which bundles the **stale published
   `@united-workforce/protocol@0.4.0`** whose built template predates the #394
   fix (0 occurrences of `Content ---`). The `protocol@0.4.0` version bump is an
   ancestor of `63d03e1`, and changeset `.changeset/392-step-show-metadata.md`
   (which bumps `@united-workforce/protocol` minor) is still **pending** — i.e.
   the template fix is in source but **unreleased**.

The real defect class is a **missing regression guard**: #394 shipped the
template + mapper flattening with **no test** asserting the rendered text
actually contains the turn bodies, so a stale build / accidental retarget goes
undetected. This spec locks the rendered behavior in.

## Given
- The repo at `origin/main` (HEAD), `@ocas/*` and `liquidjs` installed via `pnpm install`
- A StepNode whose `detail` ref expands to a broker-detail payload
  `{ sessionId, duration, turnCount, turns }` where `turns` resolves to ≥ 1
  assistant turn node(s), each a `{ role: "assistant", content: <body> }` object —
  e.g. a reviewer step with 9 turns (`38612` in / `10584` out)
- The StepNode payload carries `role`, `agent`, `startedAtMs`, `completedAtMs`,
  and `usage: { turns, inputTokens, outputTokens, duration }`
- `step show` renders through the envelope path:
  `cmdStepShow` → `toStepDetailPayload` → `writeEnvelope` →
  `renderEnvelopeText` (Liquid template `@ocas/template/text/<step-detail-hash>`),
  **not** the legacy `formatOutput`/`renderStepShow` registry

## When
- The user runs `uwf step show <step-hash>` (default `text` format)
- The user runs `uwf step show <step-hash> --format json`

## Then
- The `text` output contains the metadata header **and** the turn-content block,
  in this exact shape (label column run-of-spaces aligned, single trailing newline):
  ```
  Step    <hash>
  Role    reviewer
  Agent   claude-code
  Status  reviewed
  Duration 137.4s
  Usage   38612 in / 10584 out / 9 turns
  Turns   9

  --- Content ---
  [assistant] <turn 0 content body>
  [assistant] <turn 1 content body>
  ...
  ```
- The `--- Content ---` block is present whenever the resolved turn list is
  non-empty; each turn renders as `[{{ turn.role }}] {{ turn.content }}` from the
  **top-level** `turns` array produced by `toStepDetailPayload` (the mapper's
  `detail.turns` → top-level flattening), **not** from `detail.turns` inside the
  template.
- The `Usage` line is rendered from the **top-level** `usage` object and is
  omitted only when `usage` is `null`. The `Turns` count equals `turns.size`.
- The template `STEP_DETAIL_TEMPLATE` continues to reference top-level `turns`,
  `usage`, and `durationMs` (the post-#394 shape). It is **not** changed to
  `detail.turns` — doing so is explicitly out of scope and would contradict the
  mapper contract and the `@uwf/output/step-detail` schema (which `requires`
  top-level `turns`).
- `--format json` emits the self-describing envelope `{ type, value }` whose
  `value` validates against `STEP_DETAIL_OUTPUT_SCHEMA`: both `value.turns`
  (top-level, length = turn count) and `value.detail.turns` (raw passthrough)
  are populated and carry the same turn content. JSON consumers reading either
  path are unaffected.
- When the step has **zero** turns, the metadata header still renders and the
  `Turns` / `--- Content ---` block is omitted (the `{% if turns and turns.size
  > 0 %}` guard is false) — no crash, single trailing newline preserved.
- The existing guards in `cmdStepShow` are unchanged: `node <hash> is not a
  StepNode` and `step <hash> has no detail`.

## Regression test (the headline deliverable)
- A new/extended test exercises the **full text path** for a freshly written
  StepNode + broker-detail pair with ≥ 2 assistant turns and asserts the
  rendered text (via `writeEnvelope`/`renderEnvelopeText`, or by rendering
  `OUTPUT_TEMPLATES["step-detail"]` against `toStepDetailPayload(...)` output)
  **contains** `--- Content ---` and **each turn's `content` substring** and the
  `Turns   N` line. Place it alongside
  `packages/cli/src/__tests__/step-show-json.test.ts` (e.g.
  `step-show-text.test.ts`) so the JSON and text contracts are guarded together.
- The test must FAIL against the pre-#394 5-line template (proving it guards the
  regression) and PASS at HEAD.
- A complementary protocol-level template invariant is covered by the sibling
  spec `output-templates-step-detail-top-level-turns-usage.md`.

## Release
- Because the source fix already exists but is unreleased, this issue ships a
  changeset bumping `@united-workforce/cli` (and `@united-workforce/protocol` if
  the template-guard test lands there) — patch — so the corrected template and
  the new regression guard reach the published `uwf` binary. The pending
  `.changeset/392-step-show-metadata.md` already covers the original protocol
  template change; the new changeset references #403 and the added guard.
