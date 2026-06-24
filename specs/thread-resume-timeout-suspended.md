---
scenario: "A timeout-suspended thread resumes via uwf thread resume, issuing a fresh send that continues from the sumeru session by nativeId"
feature: thread
tags: [cli, thread-resume, suspend, timeout, sumeru, resume, phase2, walkthrough]
---

## Given
- A thread is in `suspended` status because a broker step hit a sumeru send timeout and took the
  `kind:"suspended"` exit (see `cli-broker-step-suspend-to-thread-suspended.md`). Its head step's
  output is `$status: "$SUSPEND"` with a timeout `reason`; the `(threadId, role)` broker session
  is still mapped to the sumeru session whose native id is `nativeId`.
- `uwf thread resume <id> -p "…"` already exists (cli.ts ~381) and is the engine's standard exit
  from `suspended`. RFC #95 specifies resume as a **fresh** SSE connection — not reattaching the
  old socket — bridged to the prior run solely by `nativeId`. The sumeru adapters natively
  resume (Phase 1): the second `send()` on a mapped session spawns with `--resume <nativeId>`.
- Phase 2 scope note: if the existing resume path already satisfies this, **no resume code
  changes** are required — this spec is the verification contract, not a new feature.

## When
- The operator continues the suspended thread:
  ```bash
  uwf thread resume <thread-id> -p "继续上次未完成的任务"
  ```

## Then
- The thread is accepted for resume (`suspended` is a valid resume precondition) and leaves
  `suspended`, advancing again.
- Resume triggers a new `broker.send()` for the suspended role on the **same** mapped
  `(threadId, role)` session; because that session already exists, the sumeru adapter issues a
  fresh connection carrying `--resume <nativeId>`, so the agent continues from its own session
  history rather than starting over.
- When `-p` is supplied, its text is delivered as the continuation prompt; the default
  continuation behavior when `-p` is omitted is whatever the existing `thread resume` already
  does (Phase 2 does not change it).
- If this resumed send now completes (`kind:"completed"`), the step writes a normal completed
  StepNode and the thread proceeds; if it times out again, it re-enters `suspended` (the gate is
  re-armed, not converted to an error).

## Notes
- This closes the RFC #95 loop at the uwf layer: `timeout → suspend (checkpoint) → resume`.
  Verification only — assert the existing resume behavior holds for a timeout-originated suspend;
  open a follow-up only if a gap is found. Full retention of pre-timeout turns and a max-suspend
  cap are explicitly Phase 3.
