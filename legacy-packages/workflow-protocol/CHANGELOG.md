# @uncaged/workflow-protocol

## 0.5.0-alpha.4

### Patch Changes

- f74b482: fix: correct internal dependency versions for prerelease
- f74b482: fix: use npm publish with pinned deps instead of bun publish (workspace:^ resolution bug)

## 0.5.0-alpha.3

### Patch Changes

- fix: use npm publish with pinned deps instead of bun publish (workspace:^ resolution bug)

## 0.5.0-alpha.2

### Patch Changes

- fix: correct internal dependency versions for prerelease

## 0.5.0-alpha.1

## 0.5.0-alpha.0

### Minor Changes

- feat: AgentFn<Opt> type boundary and createAgentAdapter bridging function (RFC #252)

## 0.4.5

### Patch Changes

- Add publishConfig to all packages for Gitea registry compatibility with changeset publish.

## 0.4.4

### Patch Changes

- Test changeset publish with Gitea registry.

## 0.4.3

### Patch Changes

- Include src/ in published packages so bun runtime can resolve the 'bun' exports condition.

## 0.4.2

### Patch Changes

- Fix workspace dependency resolution: use workspace:^ so published packages resolve to compatible versions instead of exact (non-existent) versions.

## 0.4.0

### Minor Changes

- Fix package exports for published packages and adopt changesets for version management.
