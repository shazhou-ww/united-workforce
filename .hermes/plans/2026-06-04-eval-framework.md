# Eval Framework Implementation Plan

## Goal

Build `uwf-eval` CLI + eval task infrastructure for evaluating uwf workflow quality with real agents.

## Architecture

```
uwf-eval (runner)          task package (npm)          OCAS (storage)
  │                          │                           │
  ├─ unpack tarball ───────► fixture/ → tmp cwd          │
  ├─ read task.yaml          │                           │
  ├─ uwf thread start/exec  │                           │
  ├─ run judges ───────────► dist/judges/*.js            │
  ├─ collect scores          │                           │
  └─ store results ─────────────────────────────────────► CAS nodes + variables
```

### Key Design Decisions

- **uwf-eval is NOT part of uwf** — separate package, shells out to uwf CLI
- **Task = npm package** — fixture + task.yaml + judge scripts, distributable as tarball
- **Judge = Node script** — `node <entry> <cwd> <thread-id>`, outputs `{score, data}` JSON
- **Every output is OCAS typed** — eval-run, judge results all have registered schemas
- **Builtin judges** — frontmatter compliance, upstream consumption, hallucination, token stats
- **Task-specific judges** — bundled in the task package, custom schema per judge

## Deliverables

### Phase 1: Foundation (`@united-workforce/eval`)

New package in the uwf monorepo.

```
packages/eval/
  src/
    cli.ts                    # uwf-eval entry point
    commands/
      run.ts                  # uwf-eval run
      report.ts               # uwf-eval report <hash>
      diff.ts                 # uwf-eval diff <hash> <hash>
      list.ts                 # uwf-eval list
    runner/
      prepare.ts              # unpack tarball/dir → tmp cwd
      execute.ts              # shell out to uwf thread start/exec
      collect.ts              # run judges, collect scores
    judge/
      types.ts                # JudgeInput, JudgeOutput types
      builtin/
        frontmatter.ts        # frontmatter compliance check
        upstream.ts           # upstream info consumption (LLM-as-judge)
        hallucination.ts      # hallucination detection (LLM-as-judge)
        token-stats.ts        # token usage from $usage field (#68)
    storage/
      schemas.ts              # OCAS schema definitions
      store.ts                # CAS read/write helpers
      index.ts                # variable indexing (@uwf/eval/*)
    task/
      types.ts                # TaskManifest type (task.yaml)
      loader.ts               # parse task.yaml, validate
  package.json
  tsconfig.json
```

#### OCAS Schemas to Register

1. `@uwf/eval-run` — full eval execution record
   ```
   { task, config: {agent, model, engineVersion}, threadId,
     judges: [{name, score, weight, dataHash}], overall, timestamp }
   ```

2. `@uwf/eval-judge-frontmatter` — frontmatter judge data
   ```
   { stepsTotal, stepsValid, invalidSteps: [{stepIndex, role, errors: string[]}] }
   ```

3. `@uwf/eval-judge-upstream` — upstream consumption judge data
   ```
   { perStep: [{role, consumed: string[], missed: string[], score}] }
   ```

4. `@uwf/eval-judge-hallucination` — hallucination judge data
   ```
   { perStep: [{role, hallucinations: string[], score}] }
   ```

5. `@uwf/eval-judge-token-stats` — token stats (not scored, informational)
   ```
   { totalInput, totalOutput, totalTurns, perStep: [{role, input, output, turns, duration}] }
   ```

#### CLI Design

```bash
# Run eval
uwf-eval run <task-dir-or-tarball> [--agent hermes] [--model claude-sonnet-4] [--count 20]

# View results
uwf-eval report <run-hash>        # render via ocas render
uwf-eval diff <hash1> <hash2>     # side-by-side comparison
uwf-eval list                     # list past runs
```

### Phase 2: Task Package Scaffold

Template for creating eval tasks. Also serves as the first real task.

```
eval-tasks/                        # shazhou/uwf-eval-tasks monorepo
  packages/
    _template/                     # copypaste template
      package.json
      task.yaml
      fixture/
      src/judges/
      tsconfig.json
    fix-off-by-one/                # first real task
      package.json                 # @uwf-eval/fix-off-by-one
      task.yaml
      fixture/
        src/calc.ts                # buggy calculator
        src/calc.test.ts           # test that exposes the bug
        package.json
      src/judges/
        test-pass.ts               # runs pnpm test, checks exit code
        code-quality.ts            # LLM judge: minimal change, correct fix
      schemas/
        test-pass.json             # OCAS schema for test-pass data
        code-quality.json          # OCAS schema for code-quality data
      tsconfig.json
  pnpm-workspace.yaml
  tsconfig.json
  biome.json
```

#### task.yaml Format

```yaml
name: fix-off-by-one
description: Fix an off-by-one error in a calculator's add function
workflow: solve-issue              # registered workflow name, or relative path to .yaml
prompt: "Fix the bug: add(1,2) returns 4 instead of 3"
limits:
  maxSteps: 15
  timeoutMinutes: 30
judges:
  - name: frontmatter-compliance
    weight: 0.15
    builtin: true
  - name: upstream-consumption
    weight: 0.15
    builtin: true
  - name: hallucination
    weight: 0.1
    builtin: true
  - name: token-stats
    weight: 0                      # informational, not scored
    builtin: true
  - name: test-pass
    weight: 0.3
    entry: dist/judges/test-pass.js
    schema: schemas/test-pass.json
  - name: code-quality
    weight: 0.3
    entry: dist/judges/code-quality.js
    schema: schemas/code-quality.json
```

#### Judge Script Contract

```typescript
// Input: process.argv = [node, script, cwd, threadId]
// Output: stdout JSON
// Exit 0 = success, non-zero = judge error (not low score)

import type { JudgeOutput } from "@united-workforce/eval";

const result: JudgeOutput<TestPassData> = {
  score: 1.0,      // 0.0 - 1.0
  data: {           // typed per judge schema
    command: "pnpm test",
    exitCode: 0,
    output: "3 tests passed"
  }
};

console.log(JSON.stringify(result));
```

### Phase 3: Prerequisite — $usage in Adapter Protocol (#68)

Blocked by #68. Token stats judge needs `$usage` in step nodes.

Can proceed with Phase 1+2 without it — token-stats judge just returns zeros until adapters report usage.

## Implementation Order

1. **Phase 1a**: `@united-workforce/eval` package scaffold + CLI skeleton + OCAS schemas
2. **Phase 1b**: `run` command — prepare, execute, collect flow
3. **Phase 1c**: Builtin judges — frontmatter (deterministic), upstream + hallucination (LLM-as-judge)
4. **Phase 2a**: Create `shazhou/uwf-eval-tasks` monorepo with proman
5. **Phase 2b**: First task `fix-off-by-one` with fixture repo + 2 custom judges
6. **Phase 2c**: End-to-end test: `uwf-eval run packages/fix-off-by-one --agent hermes`
7. **Phase 1d**: `report`, `diff`, `list` commands (read from CAS, render via ocas render)

## Dependencies

- `@ocas/core` + `@ocas/fs` — CAS storage
- `@united-workforce/protocol` — step node types
- `commander` — CLI framework (consistent with uwf)
- LLM API access — for LLM-as-judge (upstream, hallucination, task-specific quality judges)

## Open Questions

1. **LLM-as-judge provider config** — reuse uwf's `~/.uwf/config.yaml` provider settings? Or separate config?
2. **Workflow file location** — task.yaml references a workflow. Should the workflow YAML be inside the tarball, or reference a registered workflow by name?
3. **Non-coding tasks** — debate workflow has no fixture repo. task.yaml needs `fixture: null` or simply omit the `fixture/` dir. Runner creates empty cwd.
4. **Parallel judge execution** — judges are independent, can run in parallel. Worth the complexity?

## Risks

- LLM-as-judge consistency — same input may get different scores. Mitigation: run judge multiple times, take average? Or accept variance.
- Token cost of judges — each LLM judge call costs tokens. For a 10-step workflow with 2 LLM judges = 20 LLM calls just for judging. Acceptable?
- Fixture repo drift — if the fixture evolves, old eval runs become non-comparable. Pin fixture version in task.yaml.
