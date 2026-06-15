---
scenario: "uwf workflow show resolves local project workflows from .workflows/ directory"
feature: workflow
tags: [workflow, discovery, resolution, local]
---

## Given
- A project directory exists with `.workflows/` containing a workflow YAML file (e.g., `.workflows/solve-issue.yaml`)
- The workflow is NOT registered in the global registry (`@uwf/registry/*` variables)
- The user is in the project directory or a subdirectory

## When
- User runs: `uwf workflow show solve-issue`

## Then
- The command should discover the workflow by traversing upward from cwd to find `.workflows/`
- The command should materialize the YAML on the fly (parse, validate, store temporarily in CAS)
- The command should return the workflow details including:
  - hash (CAS reference)
  - name (from workflow payload)
  - type (workflow type hash)
  - payload (full WorkflowPayload)
  - timestamp
- The command should succeed with exit code 0

## Alternative: Folder-based layout

### Given
- A project directory exists with `.workflows/solve-issue/index.yaml`
- The workflow is NOT registered in the global registry

### When
- User runs: `uwf workflow show solve-issue`

### Then
- The command should discover the workflow in the folder-based layout
- The command should materialize and return the workflow details
- The command should succeed with exit code 0

## Alternative: Legacy .workflow/ directory

### Given
- A project directory exists with `.workflow/solve-issue.yaml` (singular, legacy)
- No `.workflows/` directory exists
- The workflow is NOT registered in the global registry

### When
- User runs: `uwf workflow show solve-issue`

### Then
- The command should discover the workflow in the legacy `.workflow/` directory
- The command should materialize and return the workflow details
- The command should succeed with exit code 0

## Alternative: Explicit file path

### Given
- A workflow YAML file exists at a specific path (e.g., `./custom-workflow.yaml`)
- The workflow is NOT in `.workflows/` or global registry

### When
- User runs: `uwf workflow show ./custom-workflow.yaml`

### Then
- The command should load the workflow from the explicit file path
- The command should materialize and return the workflow details
- The command should succeed with exit code 0

## Edge Case: Priority order

### Given
- A workflow exists in BOTH `.workflows/solve-issue.yaml` (local) AND the global registry
- The local version has description "Test workflow (local)"
- The global registry version has a different hash

### When
- User runs: `uwf workflow show solve-issue` from within the project directory

### Then
- The command should prefer the LOCAL `.workflows/` version over the global registry
- The returned workflow should have description "Test workflow (local)"
- The command should succeed with exit code 0

## Negative Case: Workflow not found

### Given
- A workflow name is provided that doesn't exist in:
  - CAS (as a hash)
  - Local `.workflows/` (in any parent directory)
  - Global registry

### When
- User runs: `uwf workflow show nonexistent-workflow`

### Then
- The command should fail with a descriptive error message
- The command should exit with non-zero exit code
