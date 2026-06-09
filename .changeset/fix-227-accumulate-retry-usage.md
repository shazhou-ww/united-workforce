---
"@united-workforce/util-agent": patch
---

fix: accumulate usage across frontmatter retries instead of overwriting

Previously, when a frontmatter retry was triggered via `options.continue()`,
the `agentResult` was overwritten — recording only the 1-turn correction
usage instead of the full primary run. Now `mergeUsage()` sums turns,
inputTokens, outputTokens, and duration across the primary run and all
retries, so `StepRecord.usage` reflects total resource consumption.
