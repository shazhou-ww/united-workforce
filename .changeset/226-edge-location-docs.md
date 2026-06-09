---
"@united-workforce/util": patch
"@united-workforce/cli": patch
---

docs: document edge `location` field and cross-cwd workflow execution (#226)

`generateWorkflowAuthoringReference()` previously documented graph edges as `{ role, prompt }` only and had no example demonstrating per-step working directory overrides. Adds to the `## Graph Routing` section:

- **Cross-cwd Execution** subsection explaining the cwd inheritance chain: `--cwd` flag → `StartNodePayload.cwd` → `Target.location` override → `StepRecord.cwd`
- **Edge Target Fields** table covering `role`, `prompt`, and the new `location` field (optional, Mustache-rendered, falls back to the thread's start cwd when `null` or omitted)
- A realistic cross-repo dispatch YAML example where a `cloner` role outputs `repoPath` and the downstream `developer` edge uses `location: "{{{repoPath}}}"` to run inside the freshly cloned working directory

Adds 10 assertions in `packages/cli/src/__tests__/prompt.test.ts` covering field documentation, the inheritance chain (in order), Mustache template support, a realistic cross-cwd YAML example, and structural placement under `## Graph Routing`.
