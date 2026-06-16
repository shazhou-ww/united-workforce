---
"@united-workforce/cli": patch
"@united-workforce/protocol": patch
---

test(#403): guard `step show` text rendering of the `--- Content ---` turn block

`uwf step show` (text) renders turns via `STEP_DETAIL_TEMPLATE` (post-#394) fed
by the `toStepDetailPayload` mapper, which flattens `detail.turns` into a
**top-level** `turns` array. That path shipped with no test asserting the
rendered text actually contains the turn bodies, so a stale build (the published
`protocol@0.4.0` predates #394) or an accidental retarget to `detail.turns`
would go undetected — the defect behind issue #403.

Adds two regression guards (no production code change; the source template and
mapper were already correct at HEAD):

- `packages/cli/src/__tests__/step-show-text.test.ts` — exercises the full text
  path `cmdStepShow → toStepDetailPayload → writeEnvelope(text) →
  renderEnvelopeText` and asserts the rendered output contains `--- Content ---`,
  each turn's `content` substring, the `Turns   N` line, the `Usage` line, and
  omits the block cleanly for zero-turn steps.
- `packages/protocol/src/__tests__/output-templates-step-detail.test.ts` — pins
  `STEP_DETAIL_TEMPLATE` to the top-level `turns` / `usage` / `durationMs` shape
  (positive + anti-regression static invariants forbidding `detail.turns`) and
  renders it against a representative payload. Adds `liquidjs` as a protocol
  devDependency for the render assertions.

Both fail against the pre-#394 5-line template and pass at HEAD. The patch bumps
re-publish the corrected template and ship the guards to the released `uwf`
binary.

Fixes #403
