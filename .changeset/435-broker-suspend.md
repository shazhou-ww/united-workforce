---
"@united-workforce/broker": minor
"@united-workforce/cli": minor
---

feat(broker): recognize sumeru `event: suspend` and wire timeout → suspend → resume (#435)

RFC #95 Phase 2. A sumeru send that hits its timeout now emits a terminal
SSE `suspend` frame instead of `done`. The broker recognizes it, the CLI
parks the thread on the existing `$SUSPEND` exit, and `uwf thread resume`
continues the run by `nativeId` — no new thread status and no new command.

**`@united-workforce/broker`**

- `sumeru-client`: `consumeSse` now handles `event: suspend`. A new
  `parseSuspendEvent` validates the `@sumeru/suspend` envelope
  (`{ reason: "timeout", nativeId, elapsedMs }`), mirroring `parseErrorEvent`;
  malformed JSON or a missing envelope surface a descriptive stream error.
  Suspend is terminal — a trailing `done` is ignored.
- New exported type `SumeruSuspendValue = Readonly<{ reason: "timeout";
  nativeId: string; elapsedMs: number }>`.
- `SumeruSendOutcome` is now a discriminated union on `kind`
  (`"completed" | "suspended"`); `output`/`done`/`assistantTurnCount` live
  only on the completed branch.
- **Breaking (pre-1.0):** `SendResult` is likewise a discriminated union —
  `kind:"completed"` carries `output` + required `done`; `kind:"suspended"`
  carries `reason`/`nativeId`/`elapsedMs` and no `done`. Consumers must
  narrow `result.kind === "completed"` before reading `output`/`done`, so
  "suspended ⇒ no done" holds at the type level.

**`@united-workforce/cli`**

- `executeBrokerStep`: when `broker.send()` returns `kind:"suspended"`
  (including inside the frontmatter-retry loop), route into the existing
  `$SUSPEND` machinery via a module-private `buildSuspendOutput` +
  the public `trySuspendFastPath` rather than the error path. The thread
  enters `suspended` (a human gate), is never retried, and records
  `nativeId`/`elapsedMs`/`reason` on the detail node for diagnostics. The
  completed path is unchanged.

The `$SUSPEND` wire format is a one-liner over `SUSPEND_STATUS`, kept private
in `broker-step.ts`: the #381 public-API cleanup deliberately keeps the
adapter-side `buildSuspendOutput` out of the `@united-workforce/util-agent`
barrel, and the broker step is engine/CLI code, not an adapter.

The resume loop is verified, not modified: `uwf thread resume` already
accepts `suspended` and issues a fresh `broker.send()` on the same mapped
`(threadId, role)` session, so the sumeru adapter resumes from its own
history by `nativeId`.
