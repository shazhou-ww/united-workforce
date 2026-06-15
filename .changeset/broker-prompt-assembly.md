---
"@united-workforce/cli": patch
---

fix(cli): assemble the full agent prompt before `broker.send()` (#387)

The broker path (`executeBrokerStep`) previously sent only the bare moderator
edge prompt (a short graph-edge sentence) to `broker.send()`, dropping the rich
context the legacy spawned-agent path assembled. Agents therefore lacked their
role definition, output-format instruction, and thread history.

`executeBrokerStep` now assembles the same five-part prompt the legacy
`buildClaudeCodePrompt` produced before sending it to the broker:

1. output-format instruction — derived from the role's frontmatter schema
2. thread progress — step count and role visit count
3. role prompt — Goal / Capabilities / Prepare / Procedure / Output sections
4. task prompt — the thread's initial user prompt
5. continuation context — steps since the last visit (re-entry) or the edge
   prompt (first visit), with recent step content on a first visit that already
   has history

The fully assembled prompt is also persisted as a CAS text node on the
`StepNode` (`assembledPrompt`), so `uwf step read --prompt` surfaces exactly
what was sent. This reuses the existing `buildRolePrompt`,
`buildOutputFormatInstruction`, `buildThreadProgress`, and
`buildContinuationPrompt` helpers from `@united-workforce/util-agent`.
