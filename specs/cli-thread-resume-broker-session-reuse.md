---
scenario: "uwf thread resume drives broker.send() on the suspended role, keeping the same Sumeru session so the agent retains context"
feature: thread
tags: [cli, thread-resume, broker, suspend, session-reuse]
---

## Given
- Thread `06FCJ...` ran a `planner` step that emitted `$status: $SUSPEND` with `reason: "needs human input on X"`
- The thread state is `suspended` with `suspendedRole = "planner"` and `suspendMessage = "needs human input on X"`
- The broker session store contains a row for `(06FCJ..., planner) → sessionId="ses_planner_abc"` from the suspending step
- A human supplies the missing info via `uwf thread resume 06FCJ... -p "the answer is 42"`

## When
- `cmdThreadResume` is invoked with `supplement = "the answer is 42"`

## Then
- `cmdThreadResume` continues to call `cmdThreadStepOnce(... { role: "planner", prompt: buildResumePrompt(suspendMessage, supplement) })` (the existing routing path is preserved — only the agent invocation inside changes)
- Inside the step, `broker.send({ threadId: "06FCJ...", role: "planner", prompt: <resume-prompt> })` finds the cached row and POSTs to the existing Sumeru session `ses_planner_abc` — the agent receives the resume prompt as a continuation of its prior context rather than a cold start
- `result.reused === true` is recorded in the structured log
- If Sumeru responds with 404 `session_not_found` (e.g. the host restarted while the thread was suspended), broker performs the documented one-shot fallback (`broker-send-session-404-fallback`): create a fresh session, upsert the new id, retry the same prompt verbatim. The fallback fires AT MOST once
- After resume, the moderator runs again on the new step's status and routes normally (no special-casing of the `resume` start condition beyond the existing `$START` re-evaluation when status was `end`)
- A subsequent `thread exec` on the same thread continues to reuse the (possibly new) cached session
- The legacy `setAskSessionId / getCachedSessionId` helpers in `@united-workforce/util-agent` are NOT used for `thread exec` / `thread resume`. The broker session store (SQLite) is the sole source of truth for `(threadId, role)` → sessionId in Phase 3 — the JSONL session-cache file is only used by `step ask` (per `cli-step-ask-fork-unchanged.md`)
- `thread cancel` after a resume still tears down the thread index entry; the session map row is **left in place** (per #364 design — sessions are not garbage-collected on $END / cancel; lifecycle GC is Phase 4 / #381)
