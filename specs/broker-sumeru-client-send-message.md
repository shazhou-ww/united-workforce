---
scenario: "client.sendMessage(gateway, sessionId, content) POSTs a message, consumes the SSE stream, and returns the last assistant turn's content"
feature: broker
tags: [broker, sumeru, http, sse, message]
---

## Given
- A `SumeruClient` was created via `createSumeruClient(host)`
- A session id `ses_abc` was previously created via `createSession`
- Sumeru's message endpoint streams a Server-Sent Events response with frames terminated by blank lines and events typed `turn`, `done`, `heartbeat`, or `error`

## When
- The caller invokes `await client.sendMessage({ gateway: "claude-code", sessionId: "ses_abc", content: "hello" })`

## Then
- Broker issues `POST <host>/gateways/claude-code/sessions/ses_abc/messages`
- Request headers include `Content-Type: application/json` and `Accept: text/event-stream`
- Request body is `{"content":"hello"}`
- Broker reads the response body as a stream (no `await response.text()` — backpressure preserved) and pushes chunks through an incremental SSE parser
- The parser tolerates CRLF or LF terminators and multi-line `data:` payloads per the EventSource spec
- `heartbeat` frames are ignored
- `turn` frames with `parsed.type === "@sumeru/turn"` and `parsed.value.role === "assistant"` are accumulated; non-assistant turns are counted but not retained
- `done` frames with `parsed.type === "@sumeru/summary"` end consumption and become the per-exchange summary (`turnCount`, `durationMs`, `tokens`)
- `error` frames end consumption and cause the function to reject with an `Error` whose message is `sumeru <code>: <message>`
- On a normal close the function resolves to a `SumeruSendOutcome`:
  - `output` — the `content` of the LAST assistant turn observed (raw string, unmodified — frontmatter extraction is Phase 3, not done here)
  - `assistantTurnCount` — number of assistant turns seen
  - `done` — the summary value from the final `done` event
- On HTTP 404 with body code `session_not_found`, the function rejects with a typed error (`SumeruSessionNotFoundError` or equivalent) carrying the code constant `sumeru_session_not_found` so `broker.send()` can recognise it for fallback
- On any other HTTP non-2xx, the function rejects with an `Error` including status, gateway, session, and instance URL
- If the stream ends without a `done` event AND without an `error` event, the function rejects with an `Error` that mentions how many turn events were observed
- If the stream produces no assistant turns at all (only system/user/tool turns) and no error, the function rejects with `sumeru SSE stream produced no assistant turns`
- The reader is always cancelled in a `finally` block so a partial read does not leak the underlying socket
