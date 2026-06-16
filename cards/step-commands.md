---
id: step-commands
title: "The `uwf step` subcommands (list / show / read / fork / ask)"
sources:
  - packages/cli/src/commands/step.ts
tags: [architecture, cli, step, cas, turns, retry-lineage, realtime-turns, phase-4]
created: 2026-06-16
updated: 2026-06-16
---

# The `uwf step` subcommands (list / show / read / fork / ask)

`step.ts` implements the read/inspect side of the step model: list the steps in
a thread, show one step's merged metadata+detail, render a step's agent turns as
markdown, fork a new thread from a step, and a disabled `ask` stub. Everything
reads back the CAS triplets that `broker-step.ts` writes (cross-link the
**`broker-step-execution`** card for the producer side). The synchronous
`CasStore` interface used throughout is defined in
`~/repos/ocas/packages/core/src/types.ts`.

## `cmdStepList` — the `[StartEntry, ...StepEntry]` chain

`cmdStepList(storageRoot, threadId)` returns a `ThreadStepsOutput`
`{ thread, workflow, steps }` where `steps` is a `StartEntry` followed by one
`StepEntry` per step:

1. `resolveHeadHash(storageRoot, threadId)` → the thread head hash.
2. `walkChain(uwf, headHash)` → `{ startHash, start, ... }` (the StartNode +
   chain metadata).
3. Build the `StartEntry` from the StartNode (`hash`, `workflow`, `prompt`,
   `timestamp`).
4. `collectOrderedSteps(uwf, headHash, chain)` returns the step hashes in
   chronological order; each is turned into a `StepEntry` via `buildStepEntry`
   (nulls skipped).

`isStepEntry(entry)` discriminates `StepEntry` from `StartEntry` by the presence
of both `"role"` and `"agent"` keys.

## `buildStepEntry` — recursive retry-lineage reconstruction

This is the subtle part. **Failed StepNodes are persisted to CAS but are never
reachable via the `prev` pointer** — the main chain only threads successful
steps. A failed attempt is recoverable *only* through the successful step's
`previousAttempts: CasRef[]`.

`buildStepEntry(uwf, stepHash)` (lines 42–76):

- returns `null` if the node is missing or not a `stepNode`;
- reads `payload.previousAttempts` and **recurses** into each prior-attempt
  hash, building a nested `StepEntry[]`. Refs that don't resolve to a StepNode
  are logged (`STP7K2QM`) and skipped; an all-empty result collapses to `null`;
- returns a `StepEntry`: `{ hash, role, output: expandOutput(...), detail,
  agent, timestamp, durationMs: completedAtMs - startedAtMs, usage,
  previousAttempts }`.

So the retry history of each step hangs off that step as a recursively-populated
`previousAttempts` tree, not as separate top-level list entries.

## `cmdStepShow` — merged metadata + detail (issue #392)

The broker-detail node alone only carries `{ sessionId, duration, turnCount,
turns }`. Rendering that directly would leave `step show` with empty
`Role`/`Agent`/`Status` and a `-` `Duration`. `cmdStepShow(storageRoot,
stepHash)` therefore **merges StepNode metadata with the expanded detail** into
one envelope (lines 197–242):

- validates the node exists and `type === schemas.stepNode`, and that
  `payload.detail` is present;
- `expandDeep(store, payload.detail)` fully expands the broker-detail payload;
- `expandOutput(uwf, payload.output)` → derive `status` from the output's
  `$status` string (or `""` if absent/non-string);
- `startedAtMs`/`completedAtMs` are kept only when finite numbers;
  `durationMs = completedAtMs - startedAtMs` only when both exist and
  `completedAtMs >= startedAtMs`, else `null`;
- returns `{ hash, role, agent, status, startedAtMs, completedAtMs, durationMs,
  usage, detail }`.

This returned object is exactly what the `@uwf/output/step-detail` schema
validates — see the **`step-detail-output-schema`** card.

## `cmdStepRead` — render `detail.turns` to markdown

`cmdStepRead(storageRoot, stepHash, quota, showPrompt)` produces human-readable
markdown for a step's turns, with two modes:

### `--prompt` mode (`showPrompt === true`)

Dumps the recorded `assembledPrompt` CAS node (the prompt `broker-step.ts`
stored under `schemas.text`):

- `payload.assembledPrompt` not a string → `_Prompt not recorded (legacy
  step)._`;
- CAS node missing → `_Prompt CAS node not found_`;
- otherwise emits `## Prompt` with the prompt text (string payload used
  directly; non-string `JSON.stringify`'d).

### Turn-rendering mode (default)

Pipeline over `detail.turns`:

1. **`loadStepDetail`** — fetch the detail node (fails if missing).
2. **`loadTurnData(store, detail.turns)`** — map each turn ref via
   `parseSingleTurn`:
   - non-string ref or missing node → skipped;
   - extracts `content` (string or `""`), `toolCalls` via
     `parseTurnToolCalls` (array of `{ name, args }`, dropping malformed
     entries), `index` (`turn.index` or fallback running index), `role`
     (`turn.role` or default `"assistant"`);
   - a turn with **both** empty content and no tool calls is dropped.
3. **`selectTurnsForQuota(turnData, availableQuota)`** — newest-first back-fill:
   iterate from the last turn, costing each rendered block
   (`## Turn N\n\n` header + `formatTurnBody`) plus a 2-char separator; stop
   once the next block would exceed the quota **and** at least one turn is
   already selected (so at least one turn always renders). Selected turns are
   `unshift`ed to preserve chronological order.
4. **`formatStepMarkdown`** — emit `# Step <hash>`, `**Role:**`, `**Agent:**`,
   an `_[Earlier turns omitted due to quota. Use --quota to increase.]_` notice
   when `turnData.length > selectedTurns.length`, then each selected turn.

The quota budget is `quota - headerSection.length - BUFFER` where `BUFFER = 200`
reserves room for the header/notice. `formatTurnBody(turn)` renders
`**Turn role:** <role>`, a bullet list of tool calls (`- **<name>** — \`<args>\``,
args suffix omitted when empty), then the content.

> Note on shape: `parseSingleTurn` reads richer fields (`index`, `toolCalls`)
> than the producer currently writes — `broker-step.ts`'s `TURN_SCHEMA` only has
> `{ role, content }`. The reader is forward-compatible: extra fields render when
> present and are absent-safe otherwise.

## `cmdStepFork` — mint an idle thread at a step

`cmdStepFork(storageRoot, stepHash)` (lines 247–275) validates the node is a
`StartNode` or `StepNode`, mints a new `ThreadId` via `generateUlid(Date.now())`,
and `setThread(varStore, newThreadId, { head: stepHash, status: "idle",
suspendedRole: null, suspendMessage: null, completedAt: null })`. Returns
`ThreadForkOutput { thread, forkedFrom: { step } }`. The new thread var lives in
the same `@uwf/thread/*` namespace documented in the **`uwf-store`** card.

## Usage aggregation across retries

- `sumStepEntryUsage(entry)` — sums `{ turns, inputTokens, outputTokens,
  duration }` of an entry **plus all nested `previousAttempts`** (null usage
  treated as zero); recursion is internal, the return is a flat aggregate.
- `aggregateThreadUsage(storageRoot, threadId)` — runs `cmdStepList`, then sums
  `sumStepEntryUsage` over every `StepEntry` (skipping the `StartEntry`). Returns
  zeros when no usage is recorded anywhere. This counts failed retry attempts'
  token spend, since those live in `previousAttempts`.

## `cmdStepAsk` — disabled stub (Phase 4 #381)

`uwf step ask` is **unavailable in 0.x**. The pre-broker spawn-agent path it
relied on was removed in #380 alongside the legacy `agents.<alias>: {command,
args}` config shape (now `{host, gateway}`). `cmdStepAsk` immediately `fail`s
with a migration pointer telling users to use `uwf thread resume <id> -p '...'`
(continue a suspended thread) or `uwf thread exec <id>` (advance an idle
thread) — both of which go through `broker.send()` and preserve the Sumeru
session. Equivalent `ask`/`fork` primitives return in Phase 4 once the broker
exposes session-fork APIs. `CmdStepAskOptions { prompt, agentOverride, fork }`
is retained for the eventual re-enable.

## Cross-links

- **`broker-step-execution`** — produces the StepNode + detail + turn CAS nodes
  (and the `assembledPrompt` text node) this module reads back; the
  `detail.turns` shape originates there.
- **`uwf-store`** — provides `createUwfStore`/`setThread` and the
  `@uwf/thread/*` variable namespace `cmdStepFork` writes into.
- **`step-detail-output-schema`** — the `@uwf/output/step-detail` schema that
  validates `cmdStepShow`'s merged envelope.
