---
scenario: "uwf-hermes falls back to the existing default timeout when neither --timeout nor UWF_HERMES_TIMEOUT is set"
feature: agent-hermes
tags: [agent, hermes, timeout, default]
---

## Given

- `uwf-hermes` is invoked by the engine or directly without `--timeout`
  and with no `UWF_HERMES_TIMEOUT` environment variable set
  (or with `UWF_HERMES_TIMEOUT=""`).
- The ACP client is `packages/agent-hermes/src/acp-client.ts`, where the
  current default constant is
  `const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;` (10 minutes / 600 seconds).

## When

- `uwf-hermes --thread T --role R --prompt P` is invoked.

## Then

- The effective `session/prompt` timeout MUST equal the existing default
  `PROMPT_TIMEOUT_MS` (600 seconds / 10 minutes) — i.e. introducing the new
  flag/env var MUST NOT change the default behavior for callers that do not
  opt in.
- The default value MUST remain defined as a single named constant
  (e.g. `DEFAULT_PROMPT_TIMEOUT_MS`) in
  `packages/agent-hermes/src/acp-client.ts` (or a sibling module), referenced
  by both the runtime and the unit tests.
- When the default timeout elapses, the behavior MUST match the existing
  behavior in `acp-client.ts`: `AcpTimeoutError` is caught and `prompt()`
  returns a `$SUSPEND` output with text matching
  `hermes prompt timed out after 10 minutes`.
- A unit test in `packages/agent-hermes/__tests__/` covers:
  1. neither flag nor env var set ⇒ effective timeout = default constant
  2. env var set to empty string + no flag ⇒ effective timeout = default constant
