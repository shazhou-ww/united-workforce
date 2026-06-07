---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

feat(cli): `uwf thread list` now defaults to active threads only

Changes the default behavior of `uwf thread list` to show only active threads
(idle + running). Adds a new `--all` flag to opt into the previous behavior of
listing every thread (including completed, cancelled, and suspended).

When invoked with no flags, the command now hides completed/cancelled/suspended
threads. Use `--all` to see them, or `--status <status>` to filter explicitly.
The `--status` filter wins when both are present. Resolves issue #147.
