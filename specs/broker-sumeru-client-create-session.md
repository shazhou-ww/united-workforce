---
scenario: "client.createSession(gateway) POSTs to /gateways/:gw/sessions and returns the new session id"
feature: broker
tags: [broker, sumeru, http, session]
---

## Given
- A `SumeruClient` was created via `createSumeruClient("http://127.0.0.1:7900")`
- Sumeru is reachable and the requested gateway (e.g. `claude-code`, `hermes`) is registered
- The caller may pass an optional `cwd` string identifying the workspace root the session should bind to (Sumeru #27 `workspaceRoot` support)

## When
- The caller invokes `await client.createSession({ gateway: "claude-code", cwd: "/tmp/work-xyz" })`

## Then
- Broker issues `POST http://127.0.0.1:7900/gateways/claude-code/sessions`
- Request headers include `Content-Type: application/json` and `Accept: application/json`
- Request body is JSON-encoded; when `cwd` is non-null it is sent as `{"workspaceRoot":"/tmp/work-xyz"}`; when `cwd` is `null` the body is `{}`
- On HTTP 2xx with body shape `{"type":"@sumeru/session","value":{"id":"ses_abc"}}`, the function resolves to the string `"ses_abc"`
- On HTTP non-2xx, the function rejects with an `Error` whose message includes the HTTP status, gateway, instance URL, and any `@sumeru/error` `error` code / `message` extracted from the body
- On 2xx with an unexpected body shape (missing `@sumeru/session` envelope or empty `value.id`), the function rejects with an `Error` describing status, gateway, and instance
- The function does NOT retry on its own — retry orchestration is handled higher up by `broker.send()`
