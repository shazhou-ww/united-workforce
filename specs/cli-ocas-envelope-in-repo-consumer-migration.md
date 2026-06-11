---
scenario: "In-repo consumers of uwf stdout (eval package + repo scripts) migrate to --format raw-json and the new payload field names"
feature: cli
tags: [cli, breaking, compat, eval, scripts, migration]
---

## Background

PR #320 implements issue #308 — the default `uwf` output is now `text` and
`--format json` produces an envelope. PR review identified **four in-repo
consumers** that still parse the legacy 0.5.x bare-value JSON with the old
field names. They will silently break the moment 0.6 ships.

The new payload shapes (from `packages/cli/src/output-mappers.ts`) are:

| Command                         | New `raw-json` payload (top-level keys)                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `uwf thread start`              | `{ threadId, workflowHash }`                                                              |
| `uwf thread show`               | `{ threadId, workflowHash, head, status, currentRole, suspendedRole, suspendMessage, done }` |
| `uwf thread list`               | `{ items: [{ threadId, workflowHash, workflowName, status, currentRole, startedAt, completedAt }] }` |
| `uwf thread exec [-c N]`        | `{ threadId, workflowHash, steps: [{ head, status, currentRole, done, role, suspendedRole, suspendMessage }] }` |
| `uwf step list`                 | `{ threadId, items: [{ hash, role, durationMs }] }`                                       |

All four consumers must (a) opt into `--format raw-json` so the script-friendly
bare-value JSON is emitted, and (b) read fields under the new names/shapes.

## Issue 1 — `packages/eval/src/runner/execute.ts`

### Given
- `runUwf(["thread", "start", workflow, "-p", prompt, "--cwd", workDir], cwd)` is
  currently called without `--format`, so under 0.6 it gets text output and
  `JSON.parse` throws.
- `parseThreadId` reads `obj.thread` from the parsed JSON; under the new
  payload it must read `obj.threadId`.
- `runUwf(["thread", "exec", threadId, "--agent", agent, "-c", String(maxSteps)], cwd)`
  is called for side-effects; its stdout is currently discarded but it should
  still use `--format raw-json` so future call sites that read stdout do not
  silently break, and so unit tests can assert on a parseable payload.

### When
- `execute(input)` runs under the 0.6 CLI

### Then
- `runUwf` for `thread start` is called with `--format raw-json` appended to
  its argument list (or with the equivalent argument placement that makes
  `--format` apply before the subcommand, per the CLI's commander setup).
- `parseThreadId` parses the JSON and reads `obj.threadId` (string, non-empty,
  26-char Crockford Base32). It throws a clear error mentioning `threadId`
  when the field is missing, not `thread`.
- `runUwf` for `thread exec` is also called with `--format raw-json` so the
  command emits a single bare-value `ThreadExecPayload` (not an envelope).
- Existing `execute()` tests pass without changes (they use mocked
  `UWF_BIN`); a new unit test stubs the CLI to return
  `{"threadId":"<ULID>","workflowHash":"<hash>"}` and confirms `parseThreadId`
  extracts the ULID.
- A regression test (or assertion in `__tests__/execute.test.ts`) confirms
  that the constructed `args` array contains the exact tokens
  `"--format", "raw-json"`.

## Issue 2 — `packages/eval/src/judge/builtin/read-steps.ts`

### Given
- `execFileSync("uwf", ["step", "list", threadId], ...)` is the current
  invocation; under 0.6 it gets text by default.
- The current parser does `JSON.parse(stdout) as ThreadStepsOutput` and
  returns `parsed.steps.slice(1) as StepEntry[]`.
- The new `step list` payload is `{ threadId, items: [{ hash, role, durationMs }] }`
  — there is no `steps` key, items lack `agent`/`output`, and there is no
  leading "start" entry to skip.
- Call sites in `packages/eval/src/judge/builtin/frontmatter.ts` and
  `packages/eval/src/judge/builtin/token-stats.ts` consume the returned
  `StepEntry[]`; they currently rely on richer fields (e.g. `agent`,
  per-step `frontmatter`).

### When
- `readThreadSteps(threadId)` is called under the 0.6 CLI

### Then
- The argv passed to `execFileSync` includes `"--format", "raw-json"` so
  bare-value JSON is emitted.
- The parser reads `parsed.items` (not `parsed.steps`) and returns an array
  whose entries match the new shape `{ hash, role, durationMs }`.
- The leading slice (`steps.slice(1)`) is removed — the new payload does not
  include a start entry; every `items[]` entry is a real step.
- `StepEntry` / `ThreadStepsOutput` typings in `@united-workforce/protocol`
  (or the eval package's own local types) are updated so the returned array
  type matches `{ hash, role, durationMs }[]`. If callers in
  `frontmatter.ts` / `token-stats.ts` need additional per-step data (agent,
  detail), they fetch it via a follow-up `uwf step show <hash> --format raw-json`
  call; this spec does **not** require resurrecting the old fields in
  `step list`.
- `pnpm --filter @united-workforce/eval test` passes after the migration
  (and any judge tests asserting on the consumed shape are updated).

## Issue 3 — `scripts/e2e-walkthrough.sh`

The supported E2E script breaks at four points (review comment lines 225,
230, 234, 242, 252). Each `uwf ...` invocation in the affected block must
become `uwf ... --format raw-json` (or the global flag form the CLI
accepts), and the jq paths must be updated.

### Given
- Lines around 224–253 invoke `uwf thread start`, `uwf thread list`,
  `uwf thread show`, `uwf thread exec`, `uwf step list` and pipe stdout
  through `jq`
- The legacy jq paths used: `.thread`, `.[] | select(.thread==...)`,
  `.head`, `.steps | length`, `.steps[-1].hash`

### When
- The script is run against the 0.6 CLI

### Then
- Each `uwf` call in the affected phases is updated to pass `--format raw-json`
  exactly once (either as a global flag before the subcommand or wherever
  commander accepts it; the script picks one form and uses it consistently).
- `THREAD_ID=$(echo "$OUT" | jq -r '.threadId // empty')` (was `.thread`).
- `thread list` parsing handles the new envelope shape: the script uses
  `jq -e '.items[] | select(.threadId=="'"$THREAD_ID"'")'` (was
  `.[] | select(.thread==...)`).
- `thread show` "returns head" assertion uses `jq -e '.head'` against the
  bare-value `ThreadStatusPayload` — `head` is still a top-level field, so
  the path matches; only the `--format raw-json` opt-in is new.
- `thread exec` "returns step info" assertion uses
  `jq -e '.steps[-1].head'` (was `.head`) — the new payload nests step
  info under `steps[]`.
- `step list` assertions:
  - `STEP_COUNT=$(echo "$OUT" | jq '.items | length')` (was `.steps`).
  - `LAST_STEP=$(echo "$OUT" | jq -r '.items[-1].hash // empty')` (was
    `.steps[-1].hash`).
  - The `STEP_COUNT -gt 1` threshold may need to drop to `-ge 1` because the
    new payload does not include a synthetic start entry (every items[] is a
    real step). The script's test plan is updated so the assertion reflects
    the actual minimum after the migration.
- A CI run of `scripts/e2e-walkthrough.sh` against a built 0.6 CLI prints
  `PASS` for every line in the affected phases and exits 0.

## Issue 4 — `scripts/batch-solve.sh`

### Given
- Line 57: `THREAD_JSON=$(uwf thread start solve-issue -p "$PROMPT" 2>&1)`
- Line 58: `THREAD_ID=$(echo "$THREAD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['thread'])")`
- Line 63: `STEP_OUTPUT=$(uwf thread step "$THREAD_ID" $AGENT_FLAG -c "$COUNT" 2>&1)` — note this calls `thread step` which does not exist in the current CLI; the actual subcommand is `thread exec`. This may be a pre-existing latent bug, but the migration should also correct it.
- Line 66: `LAST_DONE=$(echo "$STEP_OUTPUT" | python3 -c "import json,sys; lines=sys.stdin.read().strip(); data=json.loads(lines); print(data[-1].get('done', False))")`
  — the new payload is an **object** `{ threadId, workflowHash, steps: [...] }`,
  not a list, so `data[-1]` is wrong.

### When
- `scripts/batch-solve.sh` is run against the 0.6 CLI

### Then
- `uwf thread start solve-issue -p "$PROMPT" --format raw-json` is the call;
  `2>&1` is removed from the JSON-producing call so stderr does not corrupt
  parseable stdout (errors propagate via exit code).
- The python one-liner reads `obj['threadId']` (not `obj['thread']`).
- The step-loop subcommand is `uwf thread exec ... --format raw-json` (not
  `thread step`), so the script runs against the actual CLI surface.
- `LAST_DONE` is computed from the new payload:
  `python3 -c "import json,sys; data=json.loads(sys.stdin.read().strip()); steps=data.get('steps',[]); print(steps[-1].get('done', False) if steps else False)"`
- A smoke test (manual or scripted) of `batch-solve.sh` against a single
  small issue completes without raising a `KeyError` or `TypeError`, prints
  `Thread: <ULID>` on stdout, and either `✅ Done!` or
  `⚠️ Ran out of steps (not done)` on the last line.

## Cross-cutting expectations

- After all four fixes, `pnpm run check`, `pnpm run typecheck`, and
  `pnpm run test` continue to pass (the existing 1028-passing baseline does
  not regress, and any new unit tests added under
  `packages/eval/src/__tests__/` pass too).
- The changeset `.changeset/cli-ocas-envelope-308.md` is updated to mention
  that `@united-workforce/eval` is also bumped (likely a `patch`) because its
  internal consumers were aligned to the new payload — but if `eval` is
  private and not published, the changeset still notes the in-repo migration
  in its prose.
- The PR description (or a follow-up comment) lists the four fixed file
  paths so reviewers can verify each issue is addressed.
- No new env-var, config flag, or auto-detection is introduced — every
  consumer opts into `--format raw-json` explicitly per the
  `cli-format-breaking-change-compat.md` contract.

## Negative cases

### Forgotten `--format raw-json` on a remaining call site

#### Given
- A reviewer adds a new uwf invocation in `packages/eval/` or `scripts/` and
  forgets `--format raw-json`

#### When
- The new call runs against the 0.6 CLI

#### Then
- The text output reaches the parser and `JSON.parse` (or `jq`/`python3 -c
  "json.load"`) raises immediately — the failure is loud
- A grep check (`rg -n "uwf (thread|step|workflow|log) " packages/eval scripts`)
  is documented in the PR description as the manual verification step;
  reviewers can run it to confirm every consumer is migrated

### Field-name typo

#### Given
- A migrated call site accidentally reads `obj.thread_id` (snake_case) instead
  of `obj.threadId`

#### When
- The migrated code runs

#### Then
- The field lookup returns `undefined`/`None`, and the existing error
  ("missing thread id") fires — the migration's added clarity in error
  messages helps surface the typo immediately
