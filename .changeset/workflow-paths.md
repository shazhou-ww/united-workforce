---
"@united-workforce/cli": minor
---

feat: workflowPaths — global search paths for workflow discovery

Add `workflowPaths` config key to `~/.uwf/config.yaml` that supports a list of global search directories for workflow discovery. Resolution order: local `.workflows/` → `workflowPaths` directories → registry (deprecated). Deprecate `uwf workflow add` in favor of workflowPaths.
