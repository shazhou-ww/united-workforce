---
scenario: "broker-step routes a kind:suspended SendResult through the existing $SUSPEND exit, writing a suspend step node so the thread becomes suspended"
feature: thread
tags: [cli, broker-step, suspend, timeout, thread-suspended, phase2]
---

## Given
- `executeBrokerStep` (`packages/cli/src/commands/broker-step.ts`) drives one role through
  `broker.send()` then frontmatter-extraction + StepNode persistence.
- uwf already has a complete engine-level `$SUSPEND` mechanism (v0.4.0), reused here unchanged:
  - `trySuspendFastPath` + `uwf.schemas.suspendOutput` (`SUSPEND_OUTPUT_SCHEMA`,
    `{ $status: "$SUSPEND", reason }`) store a suspend output node bypassing the role's schema
    (broker-step.ts ~456–461);
  - `writeBrokerStepNode` persists the step node;
  - thread status resolution maps a head step whose output is `$status: "$SUSPEND"` to
    `status: "suspended"` (`buildSuspendStepOutput`, thread.ts ~96–109);
  - the exec loop stops on suspended: `if (result.done || result.status === "suspended") break;`
    (thread.ts ~1462).
- This change makes `broker.send()`'s new `kind:"suspended"` result a **second entry** into that
  same exit (the existing entry being an agent that prints `$status: "$SUSPEND"` itself):
  - Right after the primary `broker.send()` (broker-step.ts ~585), before any frontmatter work:
    `if (primary.kind === "suspended") { … }` builds the suspend output via the existing
    `suspendOutput` schema with a `reason` derived from the timeout (e.g.
    `"sumeru send timed out after 1800000ms (nativeId=ses_native_abc); resume to continue"`),
    writes a suspend step node through `writeBrokerStepNode`, records
    `reason`/`nativeId`/`elapsedMs` in the detail/payload, and returns a `BrokerStepResult` whose
    frontmatter is `{ $status: "$SUSPEND" }` (so downstream status resolves to `suspended`).
  - Every site that reads `primary.output` / `retryResult.output` (broker-step.ts ~592/594/613)
    and `brokerUsage(result)` reading `result.done` (~717–720) first narrows
    `kind === "completed"` — TypeScript enforces this against the discriminated union.
  - The frontmatter retry loop (~601–617) runs **only** on the completed branch; a suspended
    result is never retried (suspend is a human gate, not a frontmatter failure).

## When
- A step is executed where the broker's primary `send()` resolves to
  `{ kind: "suspended", reason: "timeout", nativeId: "ses_native_abc", elapsedMs: 1800000, sessionId, reused, turns }`
  (constructed via a mock / fixture):
  ```bash
  uwf thread exec <thread-id>
  ```

## Then
- `executeBrokerStep` does NOT enter the frontmatter retry loop and does NOT spawn the
  frontmatter-extraction error path; it takes the suspended branch directly.
- A step node is written via the existing `writeBrokerStepNode`, whose output node validates
  against `SUSPEND_OUTPUT_SCHEMA` (`$status: "$SUSPEND"`, `reason` non-empty). `nativeId` and
  `elapsedMs` are recorded (detail/payload) for diagnostics.
- The returned `BrokerStepResult` has `frontmatter.$status === "$SUSPEND"` and `isError === false`
  (a suspend is not an error step).
- After the step, `uwf thread show <thread-id>` reports `Status = suspended` (not `end`, `idle`,
  or `error`); `suspendMessage` carries the timeout reason.
- The exec loop (thread.ts ~1462) stops advancing at this step — running `uwf thread exec -c N`
  performs no further steps once suspended.
- Completed path is a strict regression check: when the primary `send()` is `kind:"completed"`,
  behavior is byte-for-byte unchanged from before — same extraction, same retries, same
  `brokerUsage` from `result.done`, same StepNode — because all reads are behind the
  `kind === "completed"` narrow.

## Notes
- No new thread status and no new CLI command are introduced — this is purely a new producer for
  the existing `suspended` state. Resume uses the already-shipped `uwf thread resume <id> -p "…"`
  (cli.ts ~381), which issues a fresh `send()`; since the broker reuses the cached
  `(threadId, role)` session and the sumeru adapter resumes by `nativeId`, no resume-path code
  change is required for Phase 2 (verify only). See `thread-agent-failure-suspended-resumable.md`
  for the resume precondition contract this reuses.
