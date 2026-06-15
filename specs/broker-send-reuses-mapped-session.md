---
scenario: "broker.send() reuses the cached (threadId, role) → sessionId mapping when one exists"
feature: broker
tags: [broker, send, session-store]
---

## Given
- The broker session store from Phase 1 already contains a row for `(threadId="01J...XYZ", role="planner")` with `host="http://127.0.0.1:7900"`, `gateway="claude-code"`, `sessionId="ses_existing"`
- The Sumeru endpoint at that host is healthy and recognises `ses_existing`
- Broker exposes `send({ threadId, role, prompt })` from its package barrel

## When
- The caller invokes `await broker.send({ threadId: "01J...XYZ", role: "planner", prompt: "next step" })`

## Then
- Broker calls `sessionStore.getSession("01J...XYZ", "planner")` and finds the existing record
- Broker resolves the agent config for `"planner"` from `~/.uwf/config.yaml` to get `(host, gateway)` — but the cached `host` and `gateway` are the source of truth for routing the existing session
- Broker does NOT call `client.createSession` (no new POST to `/gateways/:gw/sessions`)
- Broker calls `client.sendMessage({ gateway: "claude-code", sessionId: "ses_existing", content: "next step" })`
- The session-store row is left unchanged (no upsert) when the message succeeds
- The function resolves to an object containing at minimum `{ output: <raw last-assistant-turn content>, sessionId: "ses_existing", reused: true }` so the caller can distinguish reuse from cold start
- No frontmatter extraction is performed in Phase 2 — `output` is the raw assistant string verbatim
