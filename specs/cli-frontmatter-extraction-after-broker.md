---
scenario: "Frontmatter extraction is performed by the CLI on the raw broker.send() output, producing a StepNode CAS hash"
feature: thread
tags: [cli, broker, frontmatter, extraction, step-node, mvp]
---

## Given
- A thread step is in flight: the moderator has resolved the next role and `cmdThreadStepOnce` has just received `result: SendResult` from `broker.send()`
- `result.output` is the **raw** assistant content from the last Sumeru turn — exactly the bytes the agent emitted, with no schema parsing performed by broker
- The role's `outputSchema` is registered in CAS and accessible via the workflow payload + agent store
- `tryFrontmatterFastPath`, `trySuspendFastPath`, and `buildSuspendOutput` are still exported by `@united-workforce/util-agent`

## When
- The CLI processes `result.output` to obtain a StepNode CAS ref

## Then
- The CLI (NOT broker) drives extraction. Broker remains output-format-agnostic — `result.output` is bytes-in / bytes-out
- The CLI calls `tryFrontmatterFastPath(rawOutput, schemaHash, role, store)` first:
  - On success it receives a candidate CAS hash that satisfies the role's `outputSchema`
  - On failure (no frontmatter, invalid frontmatter, or schema validation rejected) it proceeds to the retry path below
- If the fast path fails, the CLI runs **at most `MAX_FRONTMATTER_RETRIES` (= 2)** correction turns by calling `broker.send()` AGAIN on the SAME `(threadId, role)` with the prompt produced by `buildFrontmatterRetryPrompt(...)`. Because the session map persists, retries land on the same Sumeru session — the agent gets to "fix its frontmatter" without losing context
- If `result.output` matches `trySuspendFastPath` (the reserved `$status: $SUSPEND` envelope), the CLI builds a suspend StepNode via `buildSuspendOutput` and persists `markThreadSuspended(...)` exactly as before — no retries are attempted
- After successful extraction the CLI:
  - Stores the extracted candidate as a CAS payload of type `output:<role>` (existing behaviour, unchanged)
  - Wraps it in a StepNode (`StepNodePayload`) referencing the prior head, the workflow, the role, and `usage` aggregated across primary + retries via `mergeUsage`
  - Calls the existing `finalizeAgentStep(...)` path to advance the head and update `@uwf/thread/<threadId>`
- `broker.send()` is **not** modified to emit a `stepHash` JSON line. The legacy contract — `spawnAgent` parsed the last stdout line as `{stepHash, isError, errorMessage}` — is fully replaced; broker returns a structured `SendResult` and the CLI takes responsibility for shaping the StepNode
- `executeAgentCommand`, `parseAgentOutput`, `validateAndNormalizeOutput`, and the entire `AdapterOutput`/last-line-JSON pipeline in `packages/cli/src/commands/thread.ts` are removed (or restricted to the `step ask` path — see `cli-step-ask-fork-unchanged.md`)
- All retry attempts and final outcomes are emitted through `createLogger()` with hand-written 8-char Crockford Base32 tags (no `console.*`)
