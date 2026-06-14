---
scenario: "uwf-sumeru integrates with the shared createAgent() factory so frontmatter extraction and step persistence are unchanged"
feature: agent-sumeru
tags: [agent, sumeru, util-agent, integration]
---

## Given

- The other two adapters in the monorepo (`agent-hermes`, `agent-claude-code`)
  delegate ALL of the following to `@united-workforce/util-agent`:
  1. argv parsing (`parseArgv`),
  2. uwf storage/CAS bootstrap (`resolveStorageRoot`, `getEnvPath`,
     `getGlobalCasDir`, `.env` loading via dotenv),
  3. context building (`buildContextWithMeta` → `AgentContext`),
  4. role lookup + `outputFormatInstruction` derivation from the role's
     frontmatter schema (`buildOutputFormatInstruction` + `getSchema`),
  5. frontmatter extraction (`tryFrontmatterFastPath`), suspend extraction
     (`trySuspendFastPath`),
  6. frontmatter retry loop (`retryFrontmatterExtraction`, up to
     `MAX_FRONTMATTER_RETRIES = 2`),
  7. step persistence (`writeStepNode` — building `StepNodePayload`, putting
     into CAS, validating, recording `previousAttempts`),
  8. failure path (`handleExtractionFailure` writing an `@uwf/error-output`
     CAS node, appending to `@uwf/thread-failed/*` var, emitting
     `AdapterOutput { isError: true, … }`),
  9. final stdout JSON envelope (`AdapterOutput`).
- The Phase 1 sumeru adapter is described in issue #374 as "完全复用 util-agent
  的 createAgent() 工厂".

## When

- `packages/agent-sumeru/src/sumeru.ts` exports a factory
  `createSumeruAgent(): () => Promise<void>` (or equivalent) that the CLI binary
  invokes.

## Then

- `createSumeruAgent` MUST be implemented as a thin call to
  `createAgent({ name: "sumeru", run: runSumeru, continue: continueSumeru,
   fork: null, cleanup: <closer> })` from `@united-workforce/util-agent`.
- The adapter MUST NOT implement any of steps (1)–(9) listed above
  independently. In particular:
  - No direct calls to `tryFrontmatterFastPath`, `trySuspendFastPath`,
    `buildContextWithMeta`, `writeStepNode`, `appendFailedAttempt`,
    `resolveStorageRoot`, or `getEnvPath` from outside `util-agent`.
  - No direct writes of `StepNodePayload` to CAS from the adapter — the only
    CAS node the adapter writes directly is the `@uwf/text` detail summary
    described in the SSE-consume spec.
  - No `process.stdout.write(JSON.stringify(...))` for AdapterOutput in adapter
    source — that is `createAgent`'s job.
- Naming: the agent name passed to `createAgent` is the literal string
  `"sumeru"`. The `agentLabel` helper in `util-agent` turns this into
  `"uwf-sumeru"` for `StepNodePayload.agent`, matching the binary name.
- The `cleanup` hook (if any) is responsible for closing the HTTP keep-alive
  agent / draining any in-flight SSE response stream so the Node process can
  exit cleanly after the JSON output is written. Cleanup is invoked once,
  regardless of success or failure, by the wrapper documented in
  `agent-hermes/src/hermes.ts`'s `createHermesAgent` (the `try { await
  agentMain(); } finally { await client.close(); }` pattern).
- A `fork: null` value is acceptable for Phase 1 (matches the other adapters'
  current state — `step ask` Phase 2b will add the hook later).
- An integration test in `packages/agent-sumeru/__tests__/integration.test.ts`
  stands up:
  - A tmpdir-rooted uwf storage (via the same fixtures used by
    `agent-claude-code` tests when present, or a minimal hand-rolled fixture)
    containing a workflow + thread start node + a role whose output schema is a
    minimal frontmatter schema.
  - A mock Sumeru HTTP server that returns a canned `@sumeru/session` envelope
    for `POST /sessions` and a canned SSE stream whose last assistant turn
    carries a body with valid frontmatter.
  Running `createSumeruAgent()` against this fixture produces:
  1. exactly one `POST /sessions` and one `POST /sessions/:id/messages`,
  2. a `StepNodePayload` written to CAS with `role`, `agent="uwf-sumeru"`,
     `output` pointing at the role's frontmatter output node, `detail`
     pointing at the `@uwf/text` summary node, non-null `startedAtMs` /
     `completedAtMs`, and the assembled prompt hash,
  3. a single-line stdout `AdapterOutput` JSON with `isError: false`,
     matching frontmatter and body.
