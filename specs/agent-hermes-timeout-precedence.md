---
scenario: "uwf-hermes timeout resolution honors the priority flag > env > default"
feature: agent-hermes
tags: [agent, hermes, timeout, precedence, walkthrough]
---

## Given

- `uwf-hermes` is invoked as a subprocess by the engine or directly.
- The agent-hermes package contains a pure resolver function
  (e.g. `resolveHermesTimeoutMs(argv: string[], env: NodeJS.ProcessEnv): number`)
  that computes the effective `session/prompt` timeout in milliseconds.

## When

- `resolveHermesTimeoutMs` is called with various combinations of `--timeout`
  on argv and `UWF_HERMES_TIMEOUT` in env.

## Then

- Resolution order MUST be:
  1. If `--timeout <value>` is present on argv AND `<value>` parses as a
     positive integer, the resolved value is `<value> * 1000`.
  2. Otherwise, if `process.env.UWF_HERMES_TIMEOUT` is a non-empty string AND
     parses as a positive integer, the resolved value is `<envValue> * 1000`.
  3. Otherwise, the resolved value is the default
     (`DEFAULT_PROMPT_TIMEOUT_MS`, currently `10 * 60 * 1000`).
- The resolver MUST be a pure function (no side effects, no `process.exit`
  on success path) so it can be unit-tested by passing argv/env directly.
- Invalid `--timeout` value MUST throw / return a discriminated error
  (`{ ok: false, error: "..."}`) — caller in `cli.ts` translates this into
  a non-zero exit with the message defined in
  `agent-hermes-timeout-flag.md`.
- Invalid `UWF_HERMES_TIMEOUT` value MUST throw / return a discriminated
  error — caller translates it into a non-zero exit with the message
  defined in `agent-hermes-timeout-env.md`.
- Empty `UWF_HERMES_TIMEOUT` (`""`) MUST NOT be treated as invalid; the
  resolver falls through to the default.
- A unit test in `packages/agent-hermes/__tests__/` exercises a precedence
  table:

  | argv `--timeout` | env `UWF_HERMES_TIMEOUT` | expected ms       |
  |------------------|--------------------------|-------------------|
  | `300`            | `60`                     | `300_000`         |
  | `300`            | (unset)                  | `300_000`         |
  | (absent)         | `60`                     | `60_000`          |
  | (absent)         | `""`                     | `DEFAULT`         |
  | (absent)         | (unset)                  | `DEFAULT`         |
  | `abc`            | `60`                     | error (bad flag)  |
  | (absent)         | `abc`                    | error (bad env)   |
  | `0`              | (any)                    | error (bad flag)  |
  | `-1`             | (any)                    | error (bad flag)  |
