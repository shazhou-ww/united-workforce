---
"@united-workforce/protocol": minor
"@united-workforce/util-agent": minor
"@united-workforce/cli": minor
---

feat: record failed steps in CAS and track retry lineage

When an agent step fails (e.g. frontmatter validation failure), the step is now
written to CAS with `$status: "error"` preserving turns and usage data. The thread
head is NOT advanced, so moderator routing is unaffected.

On successful retry, the new step's detail records `previousAttempts` linking to
prior failed step hashes, enabling complete attempt history visibility.
