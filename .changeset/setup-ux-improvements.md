---
"@united-workforce/cli": patch
---

fix: setup UX improvements (#114)

- Setup validates adapter availability and prints install command if missing
- Setup prints "Config saved to <path> ✓" on success
- Spawn ENOENT gives actionable error ("not found in PATH" + which command)
- SQLite ExperimentalWarning suppressed via NODE_OPTIONS in spawned processes
- Bootstrap VERSION reads cli package version (was reading util version)
- Bootstrap PATH guidance is shell-agnostic (no hardcoded .bashrc/.profile)
