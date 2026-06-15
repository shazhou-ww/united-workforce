---
scenario: "uwf thread exec -c N runs up to N broker cycles, reusing the persisted Sumeru session per (thread, role)"
feature: thread
tags: [cli, thread-exec, broker, session-reuse, multi-step]
---

## Given
- A registered workflow `solve-issue` with at least 3 distinct roles (e.g. planner → coder → reviewer)
- A thread `06FCJ...` started against that workflow with no prior steps
- The new agent config: `defaultAgent: claude-code` with host+gateway pointing at a healthy Sumeru
- The broker session store is empty for `06FCJ...`

## When
- The user runs `uwf thread exec 06FCJ... -c 10`

## Then
- The CLI loops, executing one moderator → broker.send → frontmatter-extract → finalize cycle per iteration, up to a maximum of 10 iterations
- Each iteration calls `broker.send({ threadId: "06FCJ...", role: <currentRole>, prompt: <edgePrompt> })`
- After the **first** call for a given `(threadId, role)` pair the session map is populated; subsequent iterations on the same `(threadId, role)` reuse the cached `sessionId` and `result.reused === true`
- A different role on the same iteration produces a fresh session map row (not a reuse) — so `solve-issue` with planner→coder→reviewer ends with **3** distinct session map rows after one full lap, all keyed by `(06FCJ..., <role>)`
- The loop terminates early when:
  - The moderator routes to `$END` → status `end`, exit code 0
  - A role produces `$status: $SUSPEND` → status `suspended`, exit code 0
  - A fatal error occurs (broker throws, frontmatter retries exhausted) → status `suspended` with error captured on the entry, exit code non-zero
- The loop never runs more than `count` iterations even if the moderator would happily continue
- `--background` continues to wrap the same loop inside a detached child process; the child uses the same broker plumbing as foreground exec, sharing the same SQLite-backed session store
- `pnpm test` includes an end-to-end test that runs `uwf thread exec -c 3` against a stub Sumeru (using the existing `fetch-stub.ts` style) and asserts: 3 successful steps, single session per role, head advanced 3 times, exit code 0
