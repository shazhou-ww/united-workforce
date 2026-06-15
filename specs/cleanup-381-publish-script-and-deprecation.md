---
scenario: "publish-all.mjs no longer publishes legacy adapter packages, and existing npm releases are marked deprecated"
feature: cleanup
tags: [phase4, cleanup, publish, npm, deprecation]
---

## Given
- `scripts/publish-all.mjs` currently lists `workflow-agent-hermes`, `workflow-agent-claude-code` (and treats them as workspace packages) inside its `publishOrder` array.
- The npm registry currently serves `@united-workforce/agent-hermes`, `@united-workforce/agent-claude-code`, and `@united-workforce/agent-sumeru` at their last published versions with no deprecation notice.
- After this issue, those packages are no longer in the workspace and must not be re-published from the new layout.

## When
- The maintainer:
  1. Removes the legacy adapter entries from the `publishOrder` array in `scripts/publish-all.mjs` so it only iterates active workspace packages.
  2. Runs `npm deprecate '@united-workforce/agent-hermes@*' "Replaced by @united-workforce/broker — see Phase 4 cleanup #381"` for each of the three packages (or the equivalent `npm unpublish` for unreleased versions).
  3. Runs `node scripts/publish-all.mjs --dry-run` from the repo root.

## Then
- `grep -E 'agent-hermes|agent-claude-code|agent-sumeru' scripts/publish-all.mjs` returns no match — the `publishOrder` array contains only currently-active workspace package directory names.
- `node scripts/publish-all.mjs --dry-run` exits 0 and its output never says `Publishing @united-workforce/agent-hermes`, `Publishing @united-workforce/agent-claude-code`, or `Publishing @united-workforce/agent-sumeru`.
- `npm view @united-workforce/agent-hermes deprecated` returns the deprecation message containing `Replaced by @united-workforce/broker` (and the same is true for `agent-claude-code` and `agent-sumeru`).
- The README and CHANGELOG of each archived package under `legacy-packages/` carry a note at the top stating it is archived in favor of `@united-workforce/broker`.
