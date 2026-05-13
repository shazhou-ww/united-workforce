# @uncaged/workflow-agent-cursor

## 0.4.3

### Patch Changes

- Include src/ in published packages so bun runtime can resolve the 'bun' exports condition.
- Updated dependencies
  - @uncaged/workflow-protocol@0.4.3
  - @uncaged/workflow-reactor@0.4.3
  - @uncaged/workflow-runtime@0.4.3
  - @uncaged/workflow-util-agent@0.4.3
  - @uncaged/workflow-util@0.4.3

## 0.4.2

### Patch Changes

- Fix workspace dependency resolution: use workspace:^ so published packages resolve to compatible versions instead of exact (non-existent) versions.
- Updated dependencies
  - @uncaged/workflow-protocol@0.4.2
  - @uncaged/workflow-reactor@0.4.2
  - @uncaged/workflow-runtime@0.4.2
  - @uncaged/workflow-util-agent@0.4.2
  - @uncaged/workflow-util@0.4.2

## 0.4.0

### Minor Changes

- Fix package exports for published packages and adopt changesets for version management.

### Patch Changes

- Updated dependencies
  - @uncaged/workflow-protocol@0.4.0
  - @uncaged/workflow-reactor@0.4.0
  - @uncaged/workflow-runtime@0.4.0
  - @uncaged/workflow-util-agent@0.4.0
  - @uncaged/workflow-util@0.4.0
