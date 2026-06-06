---
"@united-workforce/util-agent": patch
---

fix: render const values as literals in output format instruction (#129)

Previously `buildOutputFormatInstruction` rendered `const: greeted` as
`$status: <string>`, causing agents to output `$status: const` instead of
the actual value. Now const fields render as `$status: greeted  # required | fixed value`.
