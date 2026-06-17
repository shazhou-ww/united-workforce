---
"@united-workforce/cli": minor
---

Phase 3: Rewrite `buildTurnsPanorama` to use owner-based segmentation (#421)

This completes the Turn Chain RFC Phase 3, root-causing #412 (recurring role in-flight
mis-attribution). The `uwf step turns` panorama now:

- Walks the step-start chain via turn `owner` field instead of role-keyed vars
- Sources each segment's turns via `turnsOfStep(turnHead, stepStartHash)`
- Detects in-flight steps by matching `active-step` var to step-start hash
- Reads `edgePrompt` directly from step-start nodes

Key behavioral changes:
- Same role running multiple rounds now correctly shows separate segments
- In-flight detection no longer relies on role name (which was ambiguous for recurring roles)
- `--live` mode now polls `active-turn-head` instead of role-keyed active vars
- Legacy threads (without Phase 3 turn chain) still work via fallback path

Closes #412, #421.
