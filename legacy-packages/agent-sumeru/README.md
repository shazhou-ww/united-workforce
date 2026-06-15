# @united-workforce/agent-sumeru

An adapter that lets `uwf` drive a [Sumeru](https://git.shazhou.work/shazhou/sumeru)
instance over HTTP. The adapter exposes a `uwf-sumeru` CLI binary that the
engine spawns once per step; each invocation creates (or reuses) a Sumeru
session, posts the assembled prompt as a single `content` message, consumes the
SSE stream, and returns the last assistant turn's content as the agent's raw
output for `util-agent`'s frontmatter pipeline.

## Install / Engine Registration

```yaml
# ~/.uwf/config.yaml
agents:
  sumeru:
    command: uwf-sumeru
    args: []
defaultAgent: sumeru
```

## Adapter Config

The adapter loads its own config file (separate from the engine's `config.yaml`)
at `<UWF_HOME>/agents/sumeru.yaml`:

```yaml
instances:
  neko:
    url: https://oc-neko.shazhou.work/sumeru
    default: true
  kuma:
    url: https://oc-kuma.shazhou.work/sumeru
defaultGateway: claude-code
```

- Exactly one instance must be marked `default: true` (omitted when there is
  exactly one instance).
- `defaultGateway` is the Sumeru gateway name that will receive requests.
- `UWF_HOME` is honoured — the adapter does not hard-code `~/.uwf`.

## Session Cache

Sumeru session ids (`ses_xxx`) are cached on disk per `(threadId, role)` via the
shared `@united-workforce/util-agent` session cache (key `agentName = "sumeru"`).
The cache is shared with `uwf-hermes` / `uwf-claude-code` (same file format,
different agent-name keys) so there is no risk of cross-adapter collision.

If a cached session is rejected by Sumeru (`404 session_not_found`), the
adapter retries once by creating a fresh session.

## Wire Protocol

- `POST /gateways/<gateway>/sessions` — body `{}`, returns
  `{ type: "@sumeru/session", value: { id: "ses_xxx", ... } }` on `201`.
- `POST /gateways/<gateway>/sessions/<sessionId>/messages` — body
  `{ "content": "<prompt>" }`, `Accept: text/event-stream`, streams `turn`,
  `heartbeat`, `error`, and `done` events.

The adapter takes the last `turn` event where `value.role === "assistant"` and
uses its `value.content` string as the raw agent output.
