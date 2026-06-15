---
scenario: "Thread suspended by agent failure can be resumed with uwf thread resume"
feature: thread
tags: [agent, failure, suspended, thread-resume]
---

## Given

- A thread entered `suspended` status due to an agent failure (either recoverable or fatal)
- The thread has `suspendedRole` and `suspendMessage` set from the failure

## When

- `uwf thread resume <thread-id> -p "additional context to help agent succeed"` is run

## Then

- The thread is accepted for resume (status is `suspended`, which is a valid resume precondition)
- The suspended role is re-executed with the resume prompt (original suspend message + user supplement)
- If the agent succeeds this time, the thread advances normally
- If the agent fails again, the thread returns to `suspended` (not `idle`)
