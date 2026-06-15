---
scenario: "broker.send() creates a Sumeru session on cache miss and persists the mapping before sending the message"
feature: broker
tags: [broker, send, session-store, persistence]
---

## Given
- The broker session store contains no row for `(threadId="01J...NEW", role="reviewer")`
- The agent config for `"reviewer"` resolves to `host="http://127.0.0.1:7900"`, `gateway="hermes"`
- The Sumeru endpoint accepts session creation and returns `ses_fresh`

## When
- The caller invokes `await broker.send({ threadId: "01J...NEW", role: "reviewer", prompt: "review this" })`

## Then
- Broker calls `sessionStore.getSession("01J...NEW", "reviewer")` and gets `null`
- Broker calls `client.createSession({ gateway: "hermes", cwd: <config.cwd or null> })` and receives `"ses_fresh"`
- Broker calls `sessionStore.upsertSession({ threadId, role, host, gateway, sessionId: "ses_fresh" })` BEFORE issuing the message POST — so a crash mid-stream still leaves a reusable mapping
- Broker calls `client.sendMessage({ gateway: "hermes", sessionId: "ses_fresh", content: "review this" })`
- The function resolves to an object containing at minimum `{ output: <raw last-assistant-turn content>, sessionId: "ses_fresh", reused: false }`
- After the call returns, `sessionStore.getSession("01J...NEW", "reviewer")` returns a record with `sessionId === "ses_fresh"`
- If `client.createSession` rejects, no row is written to the session store and the rejection propagates unchanged to the caller
