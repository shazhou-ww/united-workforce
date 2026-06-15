---
scenario: "uwf-hermes accepts a --timeout <seconds> CLI flag that overrides any UWF_HERMES_TIMEOUT env var"
feature: agent-hermes
tags: [agent, hermes, cli, timeout]
---

## Given

- `uwf-hermes` is invoked as a subprocess by the engine (`uwf thread exec <id> --agent uwf-hermes`)
  OR directly: `uwf-hermes --thread <id> --role <role> --prompt <text>`.
- The agent CLI entrypoint is `packages/agent-hermes/src/cli.ts`.
- The agent talks to the Hermes ACP server via `HermesAcpClient` in `packages/agent-hermes/src/acp-client.ts`.
- The ACP `session/prompt` call is the long-running operation that must be bounded by the timeout.

## When

- `uwf-hermes --timeout 600 --thread T --role R --prompt P` is invoked
  (the `--timeout` value is an integer number of seconds).
- The Hermes ACP `session/prompt` call takes longer than 600 seconds to return.

## Then

- The `--timeout` flag MUST be parsed by the agent-hermes CLI argv parser in
  `packages/agent-hermes/src/cli.ts` (or a dedicated helper).
- The parsed value MUST be passed into `HermesAcpClient` and applied to the
  `session/prompt` request timeout (replacing the hardcoded `PROMPT_TIMEOUT_MS`
  for that prompt's `sendRequest` call).
- Unit: the value is interpreted as **seconds** (so `--timeout 600` ⇒ 600_000 ms).
- When the ACP `session/prompt` call exceeds the configured timeout, the
  existing `AcpTimeoutError` path runs and `prompt()` returns a `$SUSPEND`
  output with a message matching the form
  `hermes prompt timed out after <minutes> minutes` (consistent with
  existing behavior in `acp-client.ts`).
- The `--timeout` flag MUST take precedence over the `UWF_HERMES_TIMEOUT`
  env var when both are provided. I.e. with `UWF_HERMES_TIMEOUT=60` and
  `--timeout 600`, the effective timeout is 600 seconds.
- Invalid values for `--timeout` (non-numeric, negative, zero) MUST cause the
  CLI to exit non-zero with a message identifying the offending flag — e.g.
  `--timeout must be a positive integer (seconds); got: <value>`. Decimal
  values are not accepted.
- Passing `--timeout` MUST NOT affect any other adapter
  (`uwf-claude-code`, `uwf-builtin`) — only `uwf-hermes`.
- The flag MUST NOT collide with `parseArgv` in
  `packages/util-agent/src/run.ts` — i.e. argv parsing in `cli.ts` removes
  (or otherwise consumes) `--timeout <value>` before delegating to the
  shared parser, so the shared parser still finds `--thread`, `--role`,
  `--prompt`.
- A unit test in `packages/agent-hermes/__tests__/` covers:
  1. flag-only set ⇒ effective timeout = flag value
  2. invalid flag value ⇒ non-zero exit + error message
  3. precedence: flag overrides env when both set
