# Specs

Behavior specifications for uwf CLI commands, in Given/When/Then format.

## Convention

Each spec is a **snapshot of current implementation behavior**. When the implementation changes, the corresponding spec must be updated to match.

Specs are not aspirational — they describe what the code **does**, not what it should do.

## Frontmatter Schema

Every spec file has YAML frontmatter with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `scenario` | string | One-line description of the behavior |
| `feature` | string | Which uwf command (`thread`, `workflow`, `step`, `config`) |
| `tags` | string[] | Categorization tags (e.g. `moderator`, `validate`, `graph`, `agent`) |

### Special tags

| Tag | Meaning |
|-----|---------|
| `walkthrough` | This scenario is part of the end-to-end walkthrough suite — a user-facing path worth re-running every release. The `## When` section should contain copy-pasteable commands. |

## File Naming

`<feature>-<behavior>.md` — e.g. `thread-start-from-yaml.md`, `workflow-validate-missing-edge.md`

## Suites (test batches)

`specs/suites/*.yaml` are **playlists** that reference scenarios by filename. A scenario is an atomic asset stored once and referenced by multiple suites. Two orthogonal axes:

### By test depth (`suites/*.yaml`)

| Suite | Definition | Speed | Contents |
|-------|-----------|-------|----------|
| `smoke.yaml` | Core paths, "did anything fully break" | seconds | 1-2 must-pass scenarios per domain (8) |
| `e2e-walkthrough.yaml` | Main user flow end-to-end | minutes | config → thread exec → failure recovery → list/stop/cancel → workflow → agent comms (20; all tagged `walkthrough`) |
| `comprehensive.yaml` | Full regression | slowest | all 76 behavior specs, via `includes` of every domain suite |

### By feature domain (`suites/domains/*.yaml`)

Targeted regression for one area: `thread-lifecycle` (28), `agents` (14), `cli-output` (14), `workflow-authoring` (12), `config` (4), `test-infra` (4).

### Suite schema

```yaml
suite: <name>
description: <one line>
scenarios:                 # explicit scenario list (filenames in specs/)
  - thread-exec-stale-marker-recovery.md
includes:                  # optional — pull in other suite files (de-duplicated)
  - domains/thread-lifecycle.yaml
```

A scenario may be referenced by multiple suites — `smoke` cherry-picks the most critical, `comprehensive` includes everything; the overlap shares the same single `.md`.

### Walkthrough loop (scenario → verdict → triage)

Read a suite → run each scenario's `## When` commands → assert against `## Then`:

- **Pass** → check it off.
- **Mismatch** → triage the cause:
  - spec is wrong (behavior is actually correct) → fix the spec.
  - code is wrong → open a bug issue (fix via solve-issue).

This extends the "spec = snapshot of current behavior" convention — a walkthrough verifies the snapshot still holds. The regression workhorse remains CI; suites cover the exploratory phase and help decide which scenarios are worth promoting into CI e2e tests.
