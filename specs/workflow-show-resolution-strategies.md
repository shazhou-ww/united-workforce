---
scenario: "uwf workflow show follows correct resolution strategy priority order"
feature: workflow
tags: [workflow, resolution, strategy, priority]
---

## Background

According to the CLI reference documentation, `uwf workflow show <id>` should resolve workflows using these strategies in priority order:

1. **CAS hash** — a 13-char Crockford Base32 string is loaded directly from CAS
2. **File path** — a relative or absolute `.yaml`/`.yml` path is materialized on the fly
3. **Local `.workflows/` (cwd upward)** — search from cwd upward for `.workflows/<name>.yaml`
4. **Global registry** — `@uwf/registry/<name>` variable lookup

## Strategy 1: CAS Hash Resolution

### Given
- A workflow exists in CAS with hash `32GCDE899RRQ3` (13-char Crockford Base32)

### When
- User runs: `uwf workflow show 32GCDE899RRQ3`

### Then
- The command should load the workflow directly from CAS using the hash
- The command should return the workflow details
- The command should NOT attempt other resolution strategies
- The command should succeed with exit code 0

### Negative Case: Invalid hash format

### Given
- User provides a hash with invalid Crockford Base32 characters

### When
- User runs: `uwf workflow show 123456789ABCD` (contains 'I', invalid in Crockford)

### Then
- The command should fail with an error indicating invalid hash format
- The command should exit with non-zero exit code

### Negative Case: Valid hash format but not in CAS

### Given
- User provides a valid Crockford Base32 hash that doesn't exist in CAS

### When
- User runs: `uwf workflow show 0000000000000`

### Then
- The command should fail with an error indicating CAS node not found
- The command should exit with non-zero exit code

## Strategy 2: File Path Resolution

### Given
- A workflow YAML file exists at `./workflows/custom-workflow.yaml`
- No workflow with the name "custom-workflow" exists in global registry

### When
- User runs: `uwf workflow show ./workflows/custom-workflow.yaml`

### Then
- The command should detect the file path (contains `/` or has `.yaml`/`.yml` extension)
- The command should load, parse, validate, and materialize the workflow from the file
- The command should temporarily store it in CAS and return the details
- The command should succeed with exit code 0

### Edge Case: File path takes priority over local discovery

### Given
- A workflow file exists at `./custom-solve-issue.yaml` with name "custom-solve-issue"
- Another workflow exists at `.workflows/solve-issue.yaml` with name "solve-issue"

### When
- User runs: `uwf workflow show ./custom-solve-issue.yaml`

### Then
- The command should load from the explicit file path `./custom-solve-issue.yaml`
- The command should return the "custom-solve-issue" workflow, NOT "solve-issue"
- The command should succeed with exit code 0

## Strategy 3: Local Discovery (Parent Traversal)

### Given
- A project structure:
  ```
  /project/.workflows/solve-issue.yaml
  /project/packages/cli/src/  (current directory)
  ```
- The workflow is NOT in global registry

### When
- User runs: `uwf workflow show solve-issue` from `/project/packages/cli/src/`

### Then
- The command should traverse upward from cwd
- The command should find `/project/.workflows/solve-issue.yaml`
- The command should materialize and return the workflow
- The command should succeed with exit code 0

### Supported Layouts

The local discovery should support these layouts (in priority order):

1. `.workflows/<name>.yaml` (flat file, primary extension)
2. `.workflows/<name>.yml` (flat file, alternative extension)
3. `.workflows/<name>/index.yaml` (folder-based)
4. `.workflows/<name>/index.yml` (folder-based, alternative extension)
5. `.workflow/<name>.yaml` (legacy singular directory, same priority rules)

### Edge Case: Prefers .workflows/ over .workflow/

### Given
- Both directories exist:
  - `.workflows/solve-issue.yaml` with description "primary"
  - `.workflow/solve-issue.yaml` with description "legacy"

### When
- User runs: `uwf workflow show solve-issue`

### Then
- The command should prefer `.workflows/solve-issue.yaml`
- The returned workflow should have description "primary"
- The command should succeed with exit code 0

### Edge Case: Stops at filesystem root

### Given
- User is in a deep directory `/tmp/deep/path/that/has/no/workflows/`
- No `.workflows/` or `.workflow/` directory exists in any parent up to root
- No global registry entry exists

### When
- User runs: `uwf workflow show nonexistent-workflow`

### Then
- The command should traverse up to filesystem root
- The command should fail with "workflow not found" error
- The command should exit with non-zero exit code

## Strategy 4: Global Registry Fallback

### Given
- A workflow "deploy-pipeline" is registered in `@uwf/registry/deploy-pipeline` → `45JKDE7PQSTW2`
- No local `.workflows/` directory contains this workflow
- User is in a directory without local workflows

### When
- User runs: `uwf workflow show deploy-pipeline`

### Then
- The command should fall back to global registry lookup
- The command should load the workflow from CAS using the registry hash
- The command should return the workflow details
- The command should succeed with exit code 0

## Priority Order Integration Test

### Given
- A workflow "solve-issue" exists in ALL locations:
  1. Not as a CAS hash (not applicable)
  2. File path: `./explicit-solve-issue.yaml` with description "explicit"
  3. Local: `.workflows/solve-issue.yaml` with description "local"
  4. Global registry: `@uwf/registry/solve-issue` → hash with description "global"

### When Scenarios

#### Scenario A: Explicit file path
- User runs: `uwf workflow show ./explicit-solve-issue.yaml`
- Expected: Returns workflow with description "explicit" (Strategy 2)

#### Scenario B: Local discovery (name only, from project dir)
- User runs: `uwf workflow show solve-issue` from project directory
- Expected: Returns workflow with description "local" (Strategy 3, beats Strategy 4)

#### Scenario C: Global fallback (from isolated directory)
- User runs: `uwf workflow show solve-issue` from a directory WITHOUT local workflows
- Expected: Returns workflow with description "global" (Strategy 4)

#### Scenario D: CAS hash (direct)
- User runs: `uwf workflow show 45JKDE7PQSTW2` (a valid CAS hash)
- Expected: Returns workflow directly from CAS (Strategy 1, highest priority)
