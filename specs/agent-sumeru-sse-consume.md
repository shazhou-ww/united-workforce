---
scenario: "uwf-sumeru sends a message via SSE, consumes turn events, and returns the last turn's content as raw output"
feature: agent-sumeru
tags: [agent, sumeru, sse, http, http-streaming]
---

## Given

- `runSumeru(ctx)` has resolved the target `(instance.url, defaultGateway, sessionId)`
  per the session-create spec.
- The shared prompt has been assembled via the same helpers the other adapters
  use — `buildContinuationPrompt`, `buildRolePrompt`, `buildThreadProgress`,
  `buildFrontmatterRetryPrompt` (re-exported from `@united-workforce/util-agent`).
  The sumeru adapter MUST NOT reinvent prompt assembly; it composes them in a
  way structurally analogous to `buildClaudeCodePrompt` in
  `packages/agent-claude-code/src/claude-code.ts`.
- Sumeru's wire protocol for `POST /gateways/:name/sessions/:id/messages` is
  documented in `~/repos/sumeru/packages/server/src/sse/messages.ts` and emits a
  text/event-stream with these event names:
  - `turn` — payload `{ type: "@sumeru/turn", value: Turn }` where
    `Turn = { index, role, content, timestamp, toolCalls, tokens?, hash? }`.
  - `heartbeat` — payload `{ type: "@sumeru/heartbeat", value: { elapsed } }`.
  - `error` — payload `{ type: "@sumeru/error", value: { error, message } }`.
  - `done` — payload `{ type: "@sumeru/summary", value: { turnCount, tokens, durationMs } }`.

## When

- The adapter issues `POST <instance.url>/gateways/<defaultGateway>/sessions/<sessionId>/messages`
  with:
  - HTTP method `POST`
  - `Content-Type: application/json`
  - `Accept: text/event-stream`
  - JSON body `{ "content": "<assembled prompt>" }`.
- The server streams a sequence of `turn` events (potentially interleaved with
  `heartbeat` events), followed by exactly one `done` event, and closes the
  response.
- Alternatively, the server emits a single `error` event (with no preceding `done`)
  and closes the response.

## Then

- The adapter parses the SSE stream incrementally. SSE framing rules
  (Last-Event-ID-style integer `id:` lines, multi-line `data:` payloads, blank
  line as event terminator) MUST be honoured — the adapter MAY use a small
  hand-rolled parser since pulling in a heavyweight library is unnecessary for
  this two-event-type stream. `heartbeat` events MUST be ignored (consumed and
  discarded) so they do not pollute the output.

- The adapter accumulates `turn` events in order of receipt into an array of
  `Turn` objects. Only `value.role === "assistant"` turns are considered for the
  output (`user` turns echoed back by the server are ignored). The adapter does
  NOT need to validate the full `@sumeru/turn` schema — it trusts the server's
  envelope shape and just requires `value.content` to be a string.

- On `done`:
  - The adapter takes the **last assistant turn** in the accumulated array. Its
    `value.content` string is the raw agent output (the full ReAct-loop final
    message, including any YAML frontmatter the role produced).
  - That raw string becomes the `output` field of the `AgentRunResult` returned
    to `createAgent` (which then runs the existing `tryFrontmatterFastPath`,
    `trySuspendFastPath`, and retry pipeline against it — the sumeru adapter
    does NOT reimplement extraction).
  - The `sessionId` field of `AgentRunResult` is the Sumeru `ses_xxx` id (same
    one used for the request).
  - `usage` is built from the `done` event's `value.tokens` when present
    (mapping `tokens.in → inputTokens`, `tokens.out → outputTokens`),
    `turns = <count of assistant turns in this response>`, and
    `duration = Math.round(value.durationMs / 1000)`. If the server omits
    `tokens`, `inputTokens`/`outputTokens` default to `0` and `turns` still
    reflects the count seen on the wire.

- On `error` event:
  - The SSE stream is short-circuited. The adapter throws an `Error` whose
    message is `sumeru ${value.error}: ${value.message}` (e.g.
    `sumeru adapter_error: <reason>`). This surfaces through the shared
    `runWithMessage("agent run failed", …)` wrapper just like other adapter
    failures.

- On transport errors (TCP/TLS failure, premature close before `done` or
  `error`, malformed `data:` JSON, missing `value.content`):
  - The adapter throws an `Error` describing the failure and the partial
    progress (e.g. `sumeru SSE stream ended after N turn events without done or
    error`). It MUST NOT silently return an empty output.

- `detailHash`:
  - Phase 1 does NOT record a separate per-step "detail" payload (Sumeru already
    persists every turn to ocas server-side via the `recordPayload` calls in
    `messages.ts`). The adapter writes a tiny `@uwf/text` CAS node summarising
    the SSE — `sumeru session ${sessionId} returned ${N} assistant turns,
    ${totalTokens} tokens, duration ${durationSec}s` — and uses that node's
    hash as `detailHash`. This satisfies the non-null contract of
    `AgentRunResult.detailHash` without depending on a sumeru-specific schema
    being registered in the local CAS.

- Tests:
  - `packages/agent-sumeru/__tests__/sse-consume.test.ts` uses an in-process
    `node:http` server that emits canned SSE streams and asserts:
    1. Two `turn` events (user echo + one assistant) followed by `done` →
       `AgentRunResult.output` equals the assistant turn's `content` string.
    2. Three assistant `turn` events followed by `done` → `output` equals the
       LAST assistant turn's content (last-wins).
    3. Interleaved `heartbeat` events are filtered and do not affect output.
    4. An `error` event with `{ error: "adapter_error", message: "x" }` →
       thrown error contains both pieces of text.
    5. Premature close (server ends the response without `done` or `error`) →
       thrown error mentions premature termination.
