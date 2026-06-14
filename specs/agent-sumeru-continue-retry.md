---
scenario: "uwf-sumeru's continue() reuses the cached Sumeru session for frontmatter-retry correction messages"
feature: agent-sumeru
tags: [agent, sumeru, continue, frontmatter, retry]
---

## Given

- The shared `createAgent` factory in `@united-workforce/util-agent` calls
  `options.continue(sessionId, correctionMessage, store)` when the primary
  `run()` result fails `tryFrontmatterFastPath` (see
  `retryFrontmatterExtraction` in `packages/util-agent/src/run.ts`). The
  sessionId passed in is whatever the previous `run()` / `continue()` returned
  as `AgentRunResult.sessionId`.
- For sumeru, that sessionId is the Sumeru `ses_xxx` id — the same id the
  server understands at
  `POST /gateways/<gateway>/sessions/<sessionId>/messages`.
- The adapter has the resolved `(instance.url, gateway)` from initial config
  loading; both `run()` and `continue()` close over the same `SumeruConfig`
  instance so no second config read happens.

## When

- `continue(sessionId, correctionMessage, store)` is invoked.

## Then

- The adapter issues `POST <instance.url>/gateways/<gateway>/sessions/<sessionId>/messages`
  with body `{ "content": <correctionMessage> }` — the same envelope as a normal
  prompt. There is no separate "correction" endpoint; Sumeru sessions are
  conversation-shaped and the correction is just another user turn.
- The SSE stream is consumed by the same code path used by `run()` — last
  assistant turn's `content` becomes the new raw output for the next
  `tryFrontmatterFastPath` attempt in `util-agent`.
- The returned `AgentRunResult` MUST have:
  - `output`: the assistant turn's `content`,
  - `sessionId`: the same `ses_xxx` (unchanged — corrections stay on the same
    session),
  - `detailHash`: a fresh `@uwf/text` CAS node summarising this retry's SSE
    (separate from the primary run's detailHash),
  - `assembledPrompt`: empty string `""` (matches the convention used by
    `hermes.ts` and `claude-code.ts`'s `continue` paths — `util-agent` only
    cares about the assembledPrompt of the PRIMARY run),
  - `usage`: built from this retry's `done` summary (input/output tokens and
    duration for this exchange only). `util-agent`'s `mergeUsage` accumulates
    it into the step's total.
- If the SSE for the correction message errors out (HTTP non-2xx, `error` event,
  or premature close), the same error-mapping rules from the SSE consume spec
  apply, and the error is rethrown so `util-agent` records the extraction
  failure properly.
- The cached `ses_xxx` MUST NOT be cleared during `continue()` — the next step
  (or a subsequent retry) keeps reusing it.
- Tests:
  - `packages/agent-sumeru/__tests__/continue.test.ts` mocks the same SSE
    server and asserts:
    1. `continue("ses_abc", "fix the frontmatter please", store)` issues
       exactly one POST to `/gateways/<gw>/sessions/ses_abc/messages` with the
       expected JSON body and Accept header.
    2. The returned `output` equals the last assistant turn from the canned
       SSE stream.
    3. The returned `sessionId` equals `"ses_abc"` (unchanged).
    4. No call to `POST /sessions` is made (no new session is created).
