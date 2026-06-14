---
scenario: "uwf-sumeru creates a Sumeru session on first visit and caches its (instance, gateway, sessionId) by (threadId, role)"
feature: agent-sumeru
tags: [agent, sumeru, session, cache, http]
---

## Given

- `uwf-sumeru --thread T --role R --prompt P` is invoked.
- The adapter has loaded valid config: one default instance `neko` with
  `url=https://oc-neko.shazhou.work/sumeru`, plus `defaultGateway: claude-code`.
- The shared session cache is the one already used by adapters: the helpers
  exported by `@united-workforce/util-agent` —
  `getCachedSessionId(agentName, threadId, role, storageRoot)` and
  `setCachedSessionId(agentName, threadId, role, sessionId, storageRoot)`.
  The sumeru adapter uses `agentName = "sumeru"`.
- The cache value for `(threadId=T, role=R)` is either absent (first visit) or
  present (cache hit from a previous step in the same thread).

## When

- `runSumeru(ctx)` from `packages/agent-sumeru/src/sumeru.ts` is invoked by the
  shared `createAgent` factory.
- Branch A — `getCachedSessionId("sumeru", T, R, storageRoot)` returns `null`:
  the adapter MUST create a fresh Sumeru session.
- Branch B — `getCachedSessionId("sumeru", T, R, storageRoot)` returns a
  non-empty string `ses_xxx`: the adapter reuses it and SKIPS session creation.

## Then

- Branch A (first visit / no cache):
  - The adapter issues `POST <instance.url>/gateways/<defaultGateway>/sessions`
    with:
    - HTTP method `POST`
    - `Content-Type: application/json`
    - `Accept: application/json`
    - JSON body `{}` (empty object — no per-session `config` is sent by this
      adapter in Phase 1)
  - On HTTP `201 Created` with body matching the `@sumeru/session` envelope
    (`{ type: "@sumeru/session", value: { id: string, gateway: string, ... } }`),
    the adapter extracts `value.id` as the Sumeru session ID (`ses_xxx` shape).
  - The new session ID is written via
    `setCachedSessionId("sumeru", T, R, value.id, storageRoot)` BEFORE the first
    message is sent. (This guarantees that a crash mid-message still leaves the
    session reusable on the next step.)
  - On any non-2xx response, or a 2xx body that doesn't match the
    `@sumeru/session` envelope shape, the adapter throws an `Error` whose
    message includes:
    - the HTTP status code,
    - the gateway and instance URL,
    - the Sumeru error code from `@sumeru/error` envelopes when present
      (e.g. `gateway_not_found`, `adapter_unavailable`, `adapter_timeout`).
    The CLI exits non-zero through the shared `fail()` path in `util-agent`'s
    `runWithMessage("agent run failed", …)` — i.e. the stderr line is
    `agent run failed: <message>`.

- Branch B (cache hit):
  - The adapter does NOT issue any `POST /sessions` call.
  - It proceeds directly to sending the message on the cached session
    (covered in the SSE consumption spec).
  - If the cached session is later rejected by Sumeru (`404 session_not_found`)
    during message send, the adapter retries ONCE by creating a fresh session
    and re-sending; the new session ID is written back to the cache. After this
    single retry, any further failure surfaces to the caller as a normal error.

- Cache key:
  - The cache key is `(agentName="sumeru", threadId, role)` — distinct from
    `(claude-code, T, R)` and `(hermes, T, R)`. Different roles in the same
    thread get separate Sumeru sessions, and the same role across two threads
    gets two separate sessions, mirroring the existing adapter conventions.
  - The cache value is JUST the Sumeru session ID string (`ses_xxx`). The
    `(instance, gateway)` tuple is NOT cached on disk — the adapter always
    re-resolves these from `sumeru.yaml` at start-up so config edits take
    effect on the next invocation without manual cache invalidation. If a
    future change adds multi-instance routing per (threadId, role), the
    persisted value can be widened, but Phase 1 stores the bare session ID.

- Tests:
  - `packages/agent-sumeru/__tests__/session-create.test.ts` MUST exercise both
    branches against a mocked HTTP layer (e.g. an in-process `node:http`
    listener that returns canned envelopes), asserting:
    1. cache miss → one POST to `/gateways/claude-code/sessions` is made,
       returns 201 with `{ value: { id: "ses_test1" } }`, and the cache is
       written with `ses_test1`.
    2. cache hit → no POST to `/sessions` is made; the cached id is used.
    3. POST returns 404 `gateway_not_found` → error message contains
       `gateway_not_found` and `claude-code`.
    4. POST returns 503 `adapter_unavailable` → error message contains
       `adapter_unavailable`.
