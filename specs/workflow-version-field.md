---
scenario: "Workflow YAML supports a top-level version field for forward compatibility"
feature: workflow
tags: [workflow, version, parse, protocol]
---

## Given
- The `WorkflowPayload` type in `@united-workforce/protocol` declares a top-level `version: number` field alongside `name`, `description`, `roles`, and `graph`
- A workflow YAML file `version-test.yaml` exists in the working directory with content:
  ```yaml
  version: 1
  name: "version-test"
  description: "A workflow that declares version: 1"
  roles:
    worker:
      description: "Test role"
      goal: "Do work"
      capabilities: []
      procedure: "noop"
      outputSchema:
        type: object
        properties:
          $status:
            type: string
            enum: [done]
        required: [$status]
  graph:
    worker:
      done:
        target: $END
  ```

## When
- User runs: `uwf workflow add ./version-test.yaml`

## Then
- The command exits with code 0
- The stored `WorkflowPayload` CAS node has `version: 1` (integer) at the top level
- `uwf workflow show version-test` includes `version: 1` in its output payload
- No warning is printed to stderr because `version` is present

## Alternative: Backward-compatible parsing of legacy workflows (no version field)

### Given
- A workflow YAML file `legacy-workflow.yaml` exists WITHOUT a top-level `version` field:
  ```yaml
  name: "legacy-workflow"
  description: "Workflow predating the version field"
  roles:
    worker:
      description: "Test role"
      goal: "Do work"
      capabilities: []
      procedure: "noop"
      outputSchema:
        type: object
        properties:
          $status:
            type: string
            enum: [done]
        required: [$status]
  graph:
    worker:
      done:
        target: $END
  ```

### When
- User runs: `uwf workflow add ./legacy-workflow.yaml`

### Then
- The command exits with code 0 (no hard failure)
- `parseWorkflowPayload` falls back to `version: 1` for the missing field
- The stored `WorkflowPayload` has `version: 1` after parsing
- A warning is printed to stderr indicating the workflow YAML is missing `version` (e.g. mentioning `version` and `legacy-workflow.yaml`)
- `uwf workflow show legacy-workflow` shows `version: 1` in the payload

## Alternative: Existing `.workflows/` and `examples/` YAML files declare `version: 1`

### Given
- All workflow YAML files under the repo's `.workflows/` directory and `examples/` directory have been updated to include `version: 1` at the top level
- Affected files in this repo include (but are not limited to):
  - `.workflows/release.yaml`
  - `.workflows/review-pr.yaml`
  - `.workflows/solve-issue.yaml`
  - `.workflows/triage-issues.yaml`
  - `examples/solve-issue.yaml`
  - `examples/review-pr.yaml`
  - `examples/debate.yaml`
  - `examples/analyze-topic.yaml`
  - `examples/eval-simple.yaml`
  - `examples/e2e-walkthrough.yaml`
  - `examples/normalize-bun-monorepo.yaml`

### When
- User runs `uwf workflow add` on each updated YAML file

### Then
- Every workflow registers successfully (exit code 0)
- No `missing version` warning is printed for any of these files
- Each registered `WorkflowPayload` carries `version: 1`

## Negative Case: Non-integer version is rejected

### Given
- A workflow YAML file `bad-version.yaml` has a non-integer `version` field:
  ```yaml
  version: "1"
  name: "bad-version"
  description: "version is a string, not an integer"
  roles: { ... }
  graph: { ... }
  ```

### When
- User runs: `uwf workflow add ./bad-version.yaml`

### Then
- `parseWorkflowPayload` returns `null` (validation fails)
- The command exits with a non-zero exit code
- An error message is printed indicating the workflow payload failed validation

## Edge Case: Existing tests do not break

### Given
- The protocol, cli, and util packages contain pre-existing tests that build and parse workflows without referencing a `version` field

### When
- The full test suite is run via `pnpm run test`

### Then
- All pre-existing tests continue to pass
- New tests that explicitly assert the `version: 1` fallback and the warning behavior also pass
- `pnpm run typecheck` passes (the new `version: number` field is required on `WorkflowPayload`, with internal construction sites supplying `1` as appropriate)
- `pnpm run check` (Biome lint + log-tag validation) passes
