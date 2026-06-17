---
"@united-workforce/cli": patch
---

fix(broker-step): correct illegal Crockford log tag that crashed on frontmatter-extraction failure (#426)

`PL_FRONTMATTER_FAIL` was `"F4FA1L7Z"` — a leet spelling of "FRONTMATTER FAIL"
that smuggled an `L` into the tag. Crockford Base32 excludes I/L/O/U, so
`assertValidLogTag()` throws on it. The tag is only used on the
frontmatter-extraction-failure path (after retries are exhausted), so it stayed
dormant until a planner step genuinely failed extraction — at which point the
failure *logger itself* crashed the `uwf thread exec` process, masking the real
error and leaving the thread stuck.

- Fix the tag: `F4FA1L7Z` → `F4FA117Z` (all-valid Crockford).
- Add a static regression guard (`log-tag-validity.test.ts`) that scans the cli
  + broker package sources and asserts every `log("…")` literal and `PL_*` tag
  constant is valid Crockford Base32 — turning this whole class of bug from a
  runtime crash into a build-time failure.
