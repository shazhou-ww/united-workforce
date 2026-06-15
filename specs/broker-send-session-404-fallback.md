---
scenario: "broker.send() silently creates a new session and retries once when Sumeru returns 404 session_not_found for a cached session id"
feature: broker
tags: [broker, send, fallback, resilience, sumeru]
---

## Given
- The broker session store contains a row for `(threadId, role)` mapping to `sessionId="ses_stale"` (from a previous run before Sumeru restarted)
- Sumeru no longer knows `ses_stale` — `POST /gateways/:gw/sessions/ses_stale/messages` responds with HTTP 404 and JSON body `{"type":"@sumeru/error","value":{"error":"session_not_found","message":"..."}}`
- Sumeru is otherwise healthy — a fresh `POST /gateways/:gw/sessions` returns `ses_new`

## When
- The caller invokes `await broker.send({ threadId, role, prompt: "..." })`

## Then
- Broker first calls `client.sendMessage` with `sessionId="ses_stale"` and observes the 404 `session_not_found` rejection
- Broker logs a structured `warn` (via `@united-workforce/util` `createLogger`) with a fixed 8-char Crockford Base32 tag and a message identifying the stale session id, gateway, and threadId/role — the warning does NOT abort the thread
- Broker calls `client.createSession({ gateway, cwd })` and gets `"ses_new"`
- Broker calls `sessionStore.upsertSession({ ..., sessionId: "ses_new" })` to overwrite the stale mapping BEFORE retrying — same write-before-stream invariant as cold-start
- Broker calls `client.sendMessage` a SECOND time with `sessionId="ses_new"` and the original `content` (the prompt is sent verbatim — broker does not modify or re-wrap it for the retry)
- On success the function resolves to `{ output, sessionId: "ses_new", reused: false }` (the `reused` flag is `false` because the message was actually sent on a freshly-created session)
- The retry is attempted AT MOST ONCE — a second 404 propagates as a normal error to the caller
- Any non-`session_not_found` error from the first POST (e.g. 500, 401, network failure) propagates without triggering the fallback
- After the call returns, `sessionStore.getSession(threadId, role)` returns a record with `sessionId === "ses_new"`
