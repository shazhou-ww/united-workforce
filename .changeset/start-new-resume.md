---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

feat: replace $START `_` status with `new`/`resume` semantics

BREAKING: All workflow YAML files must update `$START._` to `$START.new` + `$START.resume`.
The `resume` edge prompt replaces the previously hardcoded resume message in the CLI.
