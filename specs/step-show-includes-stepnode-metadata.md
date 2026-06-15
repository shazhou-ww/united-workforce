---
scenario: "step show merges StepNode metadata (role/agent/timing/usage) with detail content so the rendered output matches step list and exposes turns"
feature: step
tags: [cli, step-show, output-mappers, text-renderer, json]
---

## Given
- A thread `06FCQ...` has executed at least one step authored by the broker pipeline; the head of its chain points at StepNode `0HC7HAZBRWG80`
- That StepNode payload (CAS `step-node` schema) carries the canonical metadata fields:
  `role: "planner"`, `agent: "claude-code"`, `startedAtMs`, `completedAtMs`, `usage: { turns, inputTokens, outputTokens, duration }`, plus a `detail` ref to a `broker-detail` node
- The referenced `broker-detail` payload only declares `{ sessionId, duration, turnCount, turns }` — it does NOT carry `role`, `agent`, `status`, `startedAtMs`, or `completedAtMs`
- `uwf step list <thread-id>` already prints `planner` and `475.5s` for that same step hash because it reads `StepNodePayload` directly via `buildStepEntry`
- Pre-fix `cmdStepShow` (`packages/cli/src/commands/step.ts`) returns `expandDeep(uwf.store, payload.detail)` — i.e. only the detail node — and the text renderer prints empty strings for `Role`, `Agent`, `Status`, and `-` for `Duration`

## When
- The user runs `uwf step show 0HC7HAZBRWG80` (default `text` format)
- The user runs `uwf step show 0HC7HAZBRWG80 --format json` (and analogously `yaml`, `raw-json`, `raw-yaml`)

## Then
- `cmdStepShow` returns a single object that merges StepNode metadata with the expanded detail content. At minimum the returned shape exposes:
  - `hash` — the requested step hash (string, 13-char Crockford Base32)
  - `role` — from `StepNodePayload.role` (e.g. `"planner"`)
  - `agent` — from `StepNodePayload.agent` (e.g. `"claude-code"`)
  - `startedAtMs` — from `StepNodePayload.startedAtMs`
  - `completedAtMs` — from `StepNodePayload.completedAtMs`
  - `durationMs` — `completedAtMs - startedAtMs` (number, milliseconds; never `null` when both timing fields are set)
  - `usage` — `StepNodePayload.usage` verbatim, or `null` when the step did not record usage
  - `detail` — the expanded broker-detail payload (`{ sessionId, duration, turnCount, turns }` with each turn ref expanded inline) — preserved as a nested object so existing JSON consumers can still find `turns` under a stable path
  - `status` — extracted from the agent's frontmatter `$status` when present, otherwise `""` (matches existing `output-mappers.ts` precedence)
- `text` rendering of `step show` prints all metadata above the detail, e.g.:
  ```
  Step     0HC7HAZBRWG80
  Role     planner
  Agent    claude-code
  Status   ready
  Duration 475.5s
  Usage    2642 in / 1200 out / 1 turns
  Turns    1

  --- Content ---
  (assistant turn content rendered as markdown)
  ```
  - `Duration` reuses the existing `formatDuration` helper (seconds with one decimal, `-` only when both timing fields are missing)
  - `Usage` line is omitted when `usage` is `null`
  - The `--- Content ---` block lists each expanded turn (role + content); when `detail.turns` is empty the block is omitted but the metadata header still prints
- `json` / `yaml` / `raw-json` / `raw-yaml` formats serialize the merged object described above. JSON consumers can read `result.role`, `result.agent`, `result.usage.inputTokens`, and `result.detail.turns[].content` from a single payload — both the StepNode layer and the detail layer are present.
- The output schema registered for `step-detail` (consumed by `writeEnvelope` in `format.ts`) is updated to declare the new fields so the envelope `type` hash matches the actual payload shape; the envelope `value` validates against that schema.
- Legacy steps (no `usage`, missing `assembledPrompt`, no `previousAttempts`) still render: `usage` is `null`, the `Usage` text line is omitted, JSON includes `usage: null`.
- `cmdStepShow` continues to fail with the existing message `node <hash> is not a StepNode` when given a non-StepNode hash, and `step <hash> has no detail` when `payload.detail` is null — these guards remain unchanged.
- A unit test in `packages/cli/src/__tests__/step-show-json.test.ts` exercises a freshly written StepNode + broker-detail pair and asserts that the JSON result contains both `role: "planner"` and `detail.turns` populated. A separate text-renderer test in `packages/cli/src/__tests__/format-text-registry.test.ts` (or a new file) asserts the rendered text contains the `Role`, `Agent`, `Duration` lines with non-empty values.
- `step show` output for a given step hash now agrees with `step list` for the same step: same `role`, same `durationMs` (modulo seconds-vs-ms display), same `agent`.
