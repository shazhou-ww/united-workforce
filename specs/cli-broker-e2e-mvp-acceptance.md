---
scenario: "MVP acceptance — solve-issue and review-pr workflows complete end-to-end through broker → Sumeru with no regressions vs the legacy spawn-agent path"
feature: thread
tags: [e2e, mvp, acceptance, broker, solve-issue, review-pr]
---

## Given
- Phase 3 changes are merged onto a clean checkout
- A reachable Sumeru host (real or stubbed via `fetch-stub.ts`) exposes `claude-code` and `hermes` gateways
- `~/.uwf/config.yaml` is in the new `{host, gateway}` shape with `defaultAgent: claude-code`
- `examples/solve-issue.yaml` and `examples/review-pr.yaml` (or whichever review-pr definition the repo currently ships) are registered: `uwf workflow add ...`
- An issue (or PR) the workflow can act on is available — for the test harness, a fixture issue in a temp Gitea is sufficient

## When
- Operator runs `uwf thread start solve-issue -p "fix issue #N" --cwd <some-repo>` then loops `uwf thread exec <id> -c 50` until status is `end` or `suspended`
- Operator separately runs the equivalent flow for `review-pr`

## Then
- `solve-issue` reaches a terminal status (`end`, or `suspended` waiting for human review on a real issue) without any of the following failure modes:
  - "<adapter-binary> not found in PATH" — the legacy `executeAgentCommand` ENOENT branch is unreachable
  - JSON-parse errors on `agent stdout last line is not valid JSON` — the legacy stdout-line contract is no longer used for `thread exec`
  - SQLite errors from the session store under concurrent reads (WAL mode is on per Phase 1)
- Each role appears exactly once as a `(threadId, role)` row in the broker session store and reuses its session across all of its steps
- `review-pr` reaches a terminal status with the same guarantees
- The CLI envelope JSON on `stdout` for every `thread exec` matches the schema asserted by `packages/cli/src/__tests__/e2e-mock-agent.test.ts` — no breaking change to consumers (dashboard, scripts) of the JSON output
- `pnpm run build && pnpm run check && pnpm run typecheck && pnpm run test` all pass at the workspace root
- The new e2e test file (`packages/cli/src/__tests__/e2e-broker-thread-exec.test.ts` or similar) exercises the full pipeline against a stubbed Sumeru and is part of `pnpm run test`
- The `agent-hermes`, `agent-claude-code`, and `agent-builtin` packages are NOT removed in Phase 3 (their cleanup is Phase 4 / #381) — but `uwf thread exec` MUST NOT spawn any of their binaries. A `grep "uwf-hermes\|uwf-claude-code"` over the runtime path of `cmdThreadStepOnce` returns nothing
- A short changeset (`.changeset/<name>.md`) is added describing the breaking config change and the broker integration, with `@united-workforce/cli` and `@united-workforce/protocol` bumped (minor or patch as appropriate for 0.x)
