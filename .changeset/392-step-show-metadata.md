---
"@united-workforce/cli": minor
"@united-workforce/protocol": minor
---

fix(cli): step show now includes StepNode metadata (role, agent, timing, usage)

`step show` previously returned only the expanded detail node (broker-detail),
which lacks StepNode metadata. Now returns a merged object with `hash`, `role`,
`agent`, `status`, `startedAtMs`, `completedAtMs`, `durationMs`, `usage`, and
`detail` (the expanded broker-detail). The `frontmatter` and `turns` fields
remain accessible under the `detail` key.

Fixes #392
