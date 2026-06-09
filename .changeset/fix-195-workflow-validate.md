---
"@united-workforce/cli": minor
"@united-workforce/util": patch
---

feat(cli): add `uwf workflow validate <file>` subcommand (#195)

New CI-friendly subcommand that validates a workflow YAML file without
registering it in CAS or the workflow registry. Catches schema/semantic
mismatches (such as graph prompts referencing fields missing from a role's
frontmatter) before runtime.

- Parses YAML, runs the same `parseWorkflowPayload` shape check, the
  filename↔name consistency check, and `validateWorkflow` semantic checks
  used by `workflow add`.
- On success: silent (empty stdout, empty stderr, exit 0).
- On failure: writes a single error message to stderr and exits 1.
- Does not touch CAS, the workflow registry, or any disk state under
  `OCAS_HOME` / `UWF_HOME` — safe to run in a read-only CI sandbox.
- Resolves `!include` tags relative to the YAML file's directory, matching
  `workflow add` semantics.

The `@united-workforce/util` reference strings (`generateUsageReference`,
`generateCliReference`) are updated to document the new command.
