---
id: broker-step-execution
title: "Broker-driven step execution (executeBrokerStep)"
sources:
  - packages/cli/src/commands/broker-step.ts
tags: [architecture, broker, step, cas, persistence, realtime-turns, phase-3]
created: 2026-06-16
updated: 2026-06-16
---

# Broker-driven step execution (executeBrokerStep)

`broker-step.ts` runs one moderator-resolved role through the **Sumeru HTTP
API** and persists the result as a CAS step triplet. It is the Phase 3 (#380)
replacement for the legacy `spawnAgent` / `executeAgentCommand` /
"parse the last stdout line as JSON" path: `cmdThreadStepOnce`,
`cmdThreadResume`, and `cmdThreadPoke` now call `executeBrokerStep` instead of
spawning a per-role CLI binary.

The public surface is `executeBrokerStep(args): Promise<BrokerStepResult>`,
shaped to drop into the existing `executeAndProcessAgentStep` flow. The result
mirrors the old `AdapterOutput`: `{ stepHash, detailHash, role, frontmatter,
body, startedAtMs, completedAtMs, usage, isError, errorMessage }`.

## End-to-end flow of `executeBrokerStep`

1. **Open the broker session store** — `openBrokerSessionStore(storageRoot)`
   opens (or creates) `<storageRoot>/broker/sessions.db` (a SQLite
   `SessionStore`). It is closed in a `finally` so every exit path releases it.
2. **Resolve the agent route** — `resolveAgentRoute(...)` (see below) produces
   `{ host, gateway, cwd }`. An empty `effectiveCwd` is normalized to `null`.
3. **Create the broker** — `createBroker({ sessionStore, resolveRoute: () =>
   route, clientFactory: null })` from `@united-workforce/broker`. A fixed
   `resolveRoute` closure pins this step to the resolved route.
4. **Assemble the prompt** — `assembleBrokerPrompt(...)` builds the full
   five-part agent prompt (see below). It is stored in CAS under
   `schemas.text` so the step node can reference `assembledPrompt` (the `uwf
   step read --prompt` mode dumps this node).
5. **Primary send** — `broker.send({ threadId, role, prompt: assembledPrompt,
   onTurn: null })` returns a `SendResult` (`{ output, sessionId, done }`).
6. **Extract + retry** — `tryExtract` on the output; up to
   `MAX_FRONTMATTER_RETRIES = 2` correction retries on the *same* cached
   `(threadId, role)` session (see below).
7. **Persist the detail** — `storeBrokerDetail(...)` writes the (last) raw
   output as a single-assistant-turn detail node.
8. **Persist the step** — `writeBrokerStepNode(...)` writes the `StepNode` (or
   an error `StepNode` if extraction never succeeded) and round-trip-validates
   it.

## Agent routing: `resolveAgentRoute` / `parseAgentOverride`

`resolveAgentRoute(config, workflow, role, agentOverride, cwd)` mirrors the
legacy `resolveAgentConfig` precedence (highest first):

1. **`--agent` override** (`agentOverride !== null`):
   - first tried as an **alias** into `config.agents[override]`;
   - otherwise parsed via `parseAgentOverride` as an inline
     `"<host> <gateway>"` pair.
2. **`agentOverrides[workflow.name][role]`** — a per-(workflow, role) alias,
   only consulted when `config.agentOverrides !== null`.
3. **`config.defaultAgent`** — the fallback alias.

The chosen alias is resolved through `config.agents[alias]`; an unknown alias
calls `fail(...)`. The return is always an `AgentRoute = { host, gateway, cwd }`.

`parseAgentOverride(override)` enforces exactly two whitespace-separated tokens:

- empty string → `fail("agent override must not be empty")`;
- a single token that did **not** match an alias →
  `fail('agent override must be an alias or "<host> <gateway>"')`;
- two tokens → `{ host, gateway }`.

This deliberately removes the legacy "treat any single token as a binary path"
behaviour — a bare unknown token is now a hard error rather than a phantom
executable.

## Prompt assembly: `assembleBrokerPrompt`

`broker.send` must receive the *same* context the spawned-agent path produced,
not just the bare moderator edge prompt. `assembleBrokerPrompt` mirrors the
agent-claude-code adapter's `buildClaudeCodePrompt` and joins **five** parts
(`"\n"`-joined), using builders from `@united-workforce/util-agent`:

1. **Output-format instruction** — `buildOutputFormatInstruction(schema)` from
   the role's frontmatter/output JSON Schema (loaded out of CAS by
   `loadOutputFormatInstruction`; empty string when the schema node is missing,
   in which case the section is skipped).
2. **Thread progress** — `buildThreadProgress(steps, role, threadId)` so the
   agent knows the step count and how many times its role has run.
3. **Role prompt** — `buildRolePrompt(roleDef)` for the resolved role.
4. **Task** — a literal `## Task` heading followed by `startPrompt` (the
   `StartNode.prompt`).
5. **Continuation / edge context** — branches on visit history:
   - **Re-entry** (role already appears in `steps`): broker resumes the cached
     session, so only `buildContinuationPrompt(steps, role, edgePrompt)`
     (meta-only) is appended.
   - **First visit with prior history** (`steps.length > 0`):
     `buildContinuationPrompt(..., { includeContent: true, quota: 32000 })`
     so recent steps include content.
   - **First visit, no history**: a literal `## Current Instruction` section
     with the raw `edgePrompt`.

The prior steps are gathered by `collectStepContexts(uwf, prevHash)`, which
walks the CAS chain from `prevHash` back to the StartNode (stopping at any
non-`stepNode` node), reverses it to chronological order, and maps each
`StepNodePayload` into a `StepContext` (expanding `output` via `expandOutput`
and recovering the last assistant turn via `extractStepContent`). Honoring the
caller-supplied `prevHash` is what makes poke replace-semantics (prev = old
head's prev) reconstruct the correct history.

## broker.send and the Sumeru HTTP API

`broker.send` (from `@united-workforce/broker`) talks to a Sumeru gateway over
HTTP and returns a `SendResult`. Sessions are keyed by `(threadId, role)` in
the SQLite session store, so a second send for the same pair **resumes** the
same Sumeru session with full server-side context — this is what makes
frontmatter retries cheap and context-preserving. `onTurn: null` means this
path does not stream per-turn callbacks (turns are reconstructed from the final
output instead).

## Extraction + retry loop: `tryExtract` / `MAX_FRONTMATTER_RETRIES`

`tryExtract(uwf, rawOutput, outputSchema)` runs two ordered fast paths
(`@united-workforce/util-agent`):

1. **`trySuspendFastPath`** — detects the reserved coroutine-yield
   `$status: "$SUSPEND"` and stores it against `schemas.suspendOutput`,
   bypassing the role's own frontmatter schema.
2. **`tryFrontmatterFastPath`** — parses YAML frontmatter and validates it
   against the role's `outputSchema`.

Either returns `{ outputHash, frontmatter, body }`; otherwise `null`.

When the primary send yields `null`, the loop retries up to
`MAX_FRONTMATTER_RETRIES = 2` times. Each retry sends
`buildFrontmatterRetryPrompt(outputFormatInstruction)` over the **same**
`(threadId, role)` session (broker reuses the cached Sumeru session), so the
agent "fixes its frontmatter" with full context preserved. `lastOutput` /
`lastSessionId` track the most recent attempt; `accumulatedUsage` is folded on
every retry.

## Persistence

### `storeBrokerDetail` — the detail node

The broker returns a single final string, so the detail records exactly **one**
assistant turn:

- `TURN_SCHEMA` — `{ role: enum["assistant","tool"], content: string }`,
  `additionalProperties: false`. The turn is `{ role: "assistant", content:
  result.output }`.
- `DETAIL_SCHEMA` — `{ sessionId, duration, turnCount, turns: ocas_ref[] }`,
  `additionalProperties: false`. `duration = max(0, completedAtMs -
  startedAtMs)`, `turnCount = 1`, `turns = [turnHash]`.

Both schemas are registered via `putSchema(uwf.store, ...)` before the turn and
detail nodes are written through `uwf.store.cas.put`. This `detail.turns` shape
is exactly what the `uwf step read` renderer consumes — see the
`step-commands` card.

### `writeBrokerStepNode` — the step node (with round-trip validation)

Builds a `StepNodePayload` (`start, prev, role, output, detail, agent,
edgePrompt, startedAtMs, completedAtMs, cwd, assembledPrompt, usage,
previousAttempts`), writes it under `uwf.schemas.stepNode`, then **re-reads and
`validate`s** it. A node that fails validation calls `fail(...)` — persistence
never silently writes a malformed step. Note `agent` is recorded as
`route.gateway` (the gateway name, not the host).

### Error path: failed extraction → error StepNode

If `extracted === null` after all retries:

- an error payload `{ $status: "error", error, phase:
  "frontmatter_extraction" }` is stored under `uwf.schemas.errorOutput`
  (`error` quotes the first 500 chars of the last raw output);
- a `StepNode` is still written (so the failed attempt is persisted in CAS),
  with `previousAttempts: null`;
- the returned `BrokerStepResult` has `isError: true`, `frontmatter: { $status:
  "error" }`, `body: ""`, and the `errorMessage`.

The detail node is written **before** the error branch, so even failed steps
carry their raw output for `uwf step read`.

## Usage accounting: `brokerUsage` + `mergeUsage`

`brokerUsage(result)` normalizes Sumeru's per-exchange `done` event into the
engine `Usage` shape `{ turns, inputTokens, outputTokens, duration }`
(`done.turnCount`, `done.tokens.in/out`, `done.durationMs`; `null` when `done`
is absent). `mergeUsage` (from `@united-workforce/util-agent`) sums the primary
plus every retry into `accumulatedUsage`, which is stored on the StepNode and
returned in the result.

## Process logging tags

Eight-char Crockford-ish tags mark call sites in the process log:
`PL_BROKER_SEND = "BR0KR5ND"` (each `broker.send`), `PL_FRONTMATTER_RETRY =
"F4RTM4RT"` (each retry), `PL_FRONTMATTER_FAIL = "F4FA1L7Z"` (extraction gave
up). The per-step `args.plog` logs the broker send; the module-level `log`
(stderr sink) logs retries/failures.

## Collaborators (documented elsewhere / in prose only)

- **`@united-workforce/broker`** — `createBroker`, `broker.send`, `SendResult`,
  `SessionStore`, `createSessionStore`, `AgentRoute`. The HTTP/session layer.
- **`@united-workforce/util-agent`** — prompt builders
  (`buildOutputFormatInstruction`, `buildThreadProgress`, `buildRolePrompt`,
  `buildContinuationPrompt`, `buildFrontmatterRetryPrompt`) and extraction
  helpers (`trySuspendFastPath`, `tryFrontmatterFastPath`, `mergeUsage`).
- **`UwfStore` / `uwf.schemas`** — the CAS/var store and registered schema
  hashes everything is written through; see the `uwf-store` card.
- **`StepNodePayload` / output schemas** — see the `step-detail-output-schema`
  card for how the detail/turns are surfaced via `uwf step show`.

These are intentionally referenced in prose and not given their own cards, to
keep the realtime-turns audit focused.
