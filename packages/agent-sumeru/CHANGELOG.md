# @united-workforce/agent-sumeru

## 0.2.0

### Minor Changes

- 632d70d: feat(agent-sumeru): add HTTP adapter for Sumeru instances

  New `uwf-sumeru` CLI binary that bridges `uwf thread step` to a Sumeru HTTP instance. Cache-aware session management (`(threadId, role)` → `ses_xxx`), SSE-based message exchange (POST `/gateways/:name/sessions/:id/messages`), and full reuse of `@united-workforce/util-agent`'s `createAgent` for frontmatter extraction, retries, step persistence, and AdapterOutput emission. Adapter-owned config lives at `<UWF_HOME>/agents/sumeru.yaml` (`instances` map + `defaultGateway`).

### Patch Changes

- Updated dependencies [aeb2449]
  - @united-workforce/protocol@0.4.0
  - @united-workforce/util-agent@0.3.0
  - @united-workforce/util@0.2.1
