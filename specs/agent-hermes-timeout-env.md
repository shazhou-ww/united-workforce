---
scenario: "uwf-hermes reads UWF_HERMES_TIMEOUT env var as fallback when --timeout flag is absent"
feature: agent-hermes
tags: [agent, hermes, env, timeout]
---

## Given

- `uwf-hermes` is invoked by the engine or directly, without a `--timeout` flag.
- The environment variable `UWF_HERMES_TIMEOUT` is set to a string representing
  a positive integer number of seconds (e.g. `UWF_HERMES_TIMEOUT=600`).
- The agent CLI entrypoint is `packages/agent-hermes/src/cli.ts`.
- The ACP client is `packages/agent-hermes/src/acp-client.ts`.

## When

- `UWF_HERMES_TIMEOUT=600 uwf-hermes --thread T --role R --prompt P` is invoked.
- The Hermes ACP `session/prompt` call takes longer than 600 seconds to return.

## Then

- The agent-hermes CLI MUST read `process.env.UWF_HERMES_TIMEOUT` when
  `--timeout` is not present on argv.
- The value MUST be parsed as a positive integer (seconds). Invalid values
  (non-numeric, negative, zero, decimal) MUST cause the CLI to exit non-zero
  with an error message identifying the offending env var — e.g.
  `UWF_HERMES_TIMEOUT must be a positive integer (seconds); got: <value>`.
- An empty or unset `UWF_HERMES_TIMEOUT` MUST be treated as "not set" (fall
  through to the default), NOT an error.
- When valid, the value MUST be passed into `HermesAcpClient` and applied to
  the `session/prompt` request timeout (overriding the hardcoded
  `PROMPT_TIMEOUT_MS` for that prompt's `sendRequest` call).
- Unit: seconds (so `UWF_HERMES_TIMEOUT=600` ⇒ 600_000 ms).
- When the ACP `session/prompt` call exceeds the configured timeout, the
  existing `AcpTimeoutError` path runs and `prompt()` returns a `$SUSPEND`
  output matching the form `hermes prompt timed out after <minutes> minutes`.
- The env var MUST NOT affect other adapters
  (`uwf-claude-code`, `uwf-builtin`).
- A unit test in `packages/agent-hermes/__tests__/` covers:
  1. env var set, no flag ⇒ effective timeout = env value
  2. env var unset, no flag ⇒ default timeout (see `agent-hermes-timeout-default.md`)
  3. env var set to invalid string ⇒ non-zero exit + error message
  4. env var set to empty string ⇒ falls through to default
