---
scenario: "broker.send() returns the raw assistant turn content with no frontmatter extraction or validation in Phase 2"
feature: broker
tags: [broker, send, scope, phase2]
---

## Given
- Phase 2 explicitly excludes frontmatter extraction (Phase 3 scope)
- The Sumeru SSE stream's last assistant turn `content` is a single string, possibly containing YAML frontmatter wrapped in `---` fences plus markdown body, OR a plain string with no frontmatter at all

## When
- `broker.send({ threadId, role, prompt })` resolves successfully

## Then
- The returned `output` field equals the last assistant turn's `content` byte-for-byte — no trimming, no `parseFrontmatter()` call, no schema validation
- Broker does NOT consult `workflow.roles[role].outputSchema` in Phase 2 — schema-aware extraction is a Phase 3 responsibility
- Broker does NOT retry on missing or invalid frontmatter in Phase 2 (no `buildFrontmatterRetryPrompt` equivalent inside broker yet)
- Broker MAY include diagnostic fields alongside `output` (e.g. `assistantTurnCount`, `done` summary, `sessionId`, `reused`) but the primary contract is `output: string` for callers to extract from later
- The CLI integration is also out of scope: this spec describes the in-process API only
