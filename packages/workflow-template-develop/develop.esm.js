// bundle-entry.ts
import { createCursorAgent } from "@uncaged/workflow-agent-cursor";
import { createWorkflow } from "@uncaged/workflow-runtime";
import { optionalEnv, requireEnv } from "@uncaged/workflow-util";

// src/moderator.ts
import {
  END,
  START
} from "@uncaged/workflow-runtime";
function coderFinishedAllPlannedPhases(phases, coderCompletedPhases) {
  if (phases.length === 0) {
    return true;
  }
  const plannedHashes = new Set(phases.map((p) => p.hash));
  const lastHash = phases[phases.length - 1].hash;
  const explicit = new Set(coderCompletedPhases.filter((h) => plannedHashes.has(h)));
  if (phases.every((p) => explicit.has(p.hash))) {
    return true;
  }
  if (coderCompletedPhases.some((h) => h === lastHash)) {
    return true;
  }
  return false;
}
var plannerAborted = {
  name: "plannerAborted",
  description: "The planner aborted due to insufficient information",
  check: (ctx) => {
    const plannerStep = ctx.steps.find((s) => s.role === "planner");
    if (plannerStep === undefined) {
      return false;
    }
    return plannerStep.meta.status === "aborted";
  }
};
var allPhasesComplete = {
  name: "allPhasesComplete",
  description: "All planned phases have been completed by the coder",
  check: (ctx) => {
    const plannerStep = ctx.steps.find((s) => s.role === "planner");
    if (plannerStep === undefined) {
      return true;
    }
    const phases = plannerStep.meta.status === "planned" ? plannerStep.meta.phases : [];
    if (!Array.isArray(phases)) {
      return true;
    }
    const coderCompletedPhases = ctx.steps.filter((s) => s.role === "coder").map((s) => s.meta.completedPhase);
    return coderFinishedAllPlannedPhases(phases, coderCompletedPhases);
  }
};
var reviewApproved = {
  name: "reviewApproved",
  description: "The last reviewer approved the changes",
  check: (ctx) => {
    const last = ctx.steps[ctx.steps.length - 1];
    return last.role === "reviewer" && last.meta.status === "approved";
  }
};
var testsPassed = {
  name: "testsPassed",
  description: "The last tester reported tests passed",
  check: (ctx) => {
    const last = ctx.steps[ctx.steps.length - 1];
    return last.role === "tester" && last.meta.status === "passed";
  }
};
var table = {
  [START]: [{ condition: "FALLBACK", role: "planner" }],
  planner: [
    { condition: plannerAborted, role: END },
    { condition: "FALLBACK", role: "coder" }
  ],
  coder: [
    { condition: allPhasesComplete, role: "reviewer" },
    { condition: "FALLBACK", role: "coder" }
  ],
  reviewer: [
    { condition: reviewApproved, role: "tester" },
    { condition: "FALLBACK", role: "coder" }
  ],
  tester: [
    { condition: testsPassed, role: "committer" },
    { condition: "FALLBACK", role: "coder" }
  ],
  committer: [{ condition: "FALLBACK", role: END }]
};

// src/roles/coder.ts
import * as z from "zod/v4";
var coderMetaSchema = z.object({
  completedPhase: z.string().describe("The planner phase hash finished this round. If multiple phases were completed, use the last finished phase hash."),
  filesChanged: z.array(z.string()),
  summary: z.string()
});
var CODER_SYSTEM = `You are a **coder**. Read the thread for the plan and work on the NEXT incomplete phase only.

Run \`uncaged-workflow skill develop\` for thread ID lookup, CAS commands, and meta output guide.

## Reading phase details

Each planner phase has a content-hash and title. Read full details with \`uncaged-workflow cas get <HASH>\`.

The thread ID (26-char Crockford Base32) appears in the first message. If unsure, run \`uncaged-workflow thread list\`.

## Completing a phase

Report which phase you completed using the phase **hash** (not the title). If you legitimately finish every remaining phase in this single turn, set completedPhase to the **last** phase hash in the plan (the workflow treats that as full completion). List the files you changed and summarize what you did.

## Output rules

Keep your final response **short** — a brief summary paragraph plus the structured meta output. Do NOT paste diffs, file contents, or code blocks in your response. The actual changes are already on disk; repeating them wastes tokens. Just say what you did and why.`;
var coderRole = {
  description: "Implements the next incomplete planner phase and reports structured completion metadata.",
  systemPrompt: CODER_SYSTEM,
  schema: coderMetaSchema,
  extractRefs: (meta) => [meta.completedPhase]
};

// src/roles/committer.ts
import * as z2 from "zod/v4";
var committerMetaSchema = z2.discriminatedUnion("status", [
  z2.object({
    status: z2.literal("committed"),
    branch: z2.string(),
    commitSha: z2.string()
  }),
  z2.object({
    status: z2.literal("recoverable"),
    error: z2.string(),
    logRef: z2.string().nullable()
  }),
  z2.object({
    status: z2.literal("unrecoverable"),
    error: z2.string(),
    logRef: z2.string().nullable()
  })
]);
var COMMITTER_SYSTEM = `You are the git committer. Create a branch and commit the changes.
Report the branch name and commit SHA. On failure, classify as recoverable or unrecoverable.
Do not attempt to fix failures yourself.`;
var committerRole = {
  description: "Creates a branch and commits changes.",
  systemPrompt: COMMITTER_SYSTEM,
  schema: committerMetaSchema,
  extractRefs: null
};

// src/roles/planner.ts
import * as z3 from "zod/v4";
var phaseSchema = z3.object({
  hash: z3.string(),
  title: z3.string()
});
var plannerMetaSchema = z3.discriminatedUnion("status", [
  z3.object({
    status: z3.literal("planned"),
    phases: z3.array(phaseSchema)
  }),
  z3.object({
    status: z3.literal("aborted"),
    reason: z3.string().describe("Why the task cannot proceed")
  })
]);
var PLANNER_SYSTEM = `You are a **planner** for a software task. Break the work into **sequential phases** the coder will execute one at a time. **Abort** if the prompt lacks critical information (e.g. no project/workspace path, ambiguous target repo).

Run \`uncaged-workflow skill develop\` for thread ID lookup, CAS commands, and meta output guide.

## Prerequisites — check FIRST

The prompt MUST include an **absolute filesystem path** to the project workspace (e.g. \`/home/user/repos/my-project\`). If no workspace path is given and you cannot reliably infer one from context, **abort immediately** with a clear reason explaining what information is missing. Do NOT guess paths.

## Storing phase details — MANDATORY

For each phase, store its full detail text in CAS via \`uncaged-workflow cas put '<content>'\`. The command prints a content-hash — use that as the phase identifier.

The thread ID (26-char Crockford Base32) appears in the first message. If unsure, run \`uncaged-workflow thread list\`.

**Do NOT store phase details in any other way** — the CLI is the only supported storage mechanism.

## Phase granularity

Match the number of phases to task complexity:
- Trivial (add a config option, fix a typo, rename): 1 phase
- Small (a new feature touching 2-3 files): 1-2 phases
- Medium (cross-module refactor): 2-3 phases
- Large (new subsystem, architectural change): 3-5 phases

Fewer phases is always better. Each phase must justify its existence — if two phases would be tested together anyway, merge them.

## Output format

After storing all phases via the CLI, output compact JSON only:
  { "status": "planned", "phases": [{ "hash": "<hash-from-cas-put>", "title": "<one-line-summary>" }] }

If aborting:
  { "status": "aborted", "reason": "<what is missing>" }

Order phases so earlier steps unblock later ones. Cover root cause, edge cases, and verification across the phases.

## Output rules

Keep your final response **short** — just the JSON with phases. Do NOT paste code snippets, diffs, or implementation details in your response. Phase details are already stored in CAS; your response should only contain the compact phases JSON.`;
var plannerRole = {
  description: "Breaks the task into sequential phases for the coder.",
  systemPrompt: PLANNER_SYSTEM,
  schema: plannerMetaSchema,
  extractRefs: (meta) => meta.status === "planned" ? meta.phases.map((p) => p.hash) : []
};

// src/roles/reviewer.ts
import * as z4 from "zod/v4";
var reviewerMetaSchema = z4.discriminatedUnion("status", [
  z4.object({
    status: z4.literal("approved")
  }),
  z4.object({
    status: z4.literal("rejected"),
    issues: z4.array(z4.string()).describe("blocking issues that must be fixed")
  })
]);
var REVIEWER_SYSTEM = `You are a code reviewer. Review the git diff for correctness, consistency, and adherence to project conventions.

## Review process

1. Read the **preparer**'s output in the thread for project conventions (coding style, naming, commit format, etc.).
2. Review the diff against these conventions.
3. For documentation changes, verify that names, paths, and references match the actual codebase.

## Review checklist

- **Correctness** — does the code do what it claims? Logic bugs, off-by-one, missing returns?
- **Conventions** — naming, imports, code style per project rules?
- **Consistency** — do docs/comments match actual code? Are references current and accurate?
- **Edge cases** — missing error handling, null checks, boundary conditions?

## Verdict

- **Approve** only if there are zero issues
- **Reject** with specific issues that must be fixed — every issue you find is blocking

Be thorough. A false approve costs more than a false reject.

## Output rules

Keep your final response **short**. Summarize findings in a few bullet points, then output the structured verdict. Do NOT paste the full diff or large code blocks in your response.`;
var reviewerRole = {
  description: "Runs git diff checks and sets approved when the change is ready.",
  systemPrompt: REVIEWER_SYSTEM,
  schema: reviewerMetaSchema,
  extractRefs: null
};

// src/roles/tester.ts
import * as z5 from "zod/v4";
var testerMetaSchema = z5.discriminatedUnion("status", [
  z5.object({
    status: z5.literal("passed"),
    details: z5.string()
  }),
  z5.object({
    status: z5.literal("failed"),
    details: z5.string()
  })
]);
var TESTER_SYSTEM = `You are a tester. Run the project's test suite, build, and lint commands. Check what commands are available from the preparer's output in the thread. Report pass/fail with details of what failed.

## Output rules

Keep your final response **short**. Report pass/fail with a brief summary of failures (if any). Do NOT paste full test output or build logs — just the key error lines.`;
var testerRole = {
  description: "Runs test, build, and lint commands and reports pass or fail with details.",
  systemPrompt: TESTER_SYSTEM,
  schema: testerMetaSchema,
  extractRefs: null
};

// src/roles.ts
var DEVELOP_WORKFLOW_DESCRIPTION = "Plan phases, implement incrementally, review, verify with tests/build/lint, and commit (planner → coder [repeat per phase] → reviewer → tester → committer).";
var developRoles = {
  planner: plannerRole,
  coder: coderRole,
  reviewer: reviewerRole,
  tester: testerRole,
  committer: committerRole
};

// src/descriptor.ts
import { buildDescriptor } from "@uncaged/workflow-register";
function buildDevelopDescriptor() {
  return buildDescriptor({
    description: DEVELOP_WORKFLOW_DESCRIPTION,
    roles: developRoles,
    table
  });
}
// src/index.ts
var developWorkflowDefinition = {
  description: DEVELOP_WORKFLOW_DESCRIPTION,
  roles: developRoles,
  table
};

// bundle-entry.ts
var adapter = createCursorAgent({
  command: requireEnv("WORKFLOW_CURSOR_COMMAND", "set WORKFLOW_CURSOR_COMMAND (e.g. cursor-agent)"),
  model: optionalEnv("WORKFLOW_CURSOR_MODEL"),
  timeout: optionalEnv("WORKFLOW_CURSOR_TIMEOUT") ? Number(optionalEnv("WORKFLOW_CURSOR_TIMEOUT")) : 0,
  workspace: null
});
var wf = createWorkflow(developWorkflowDefinition, { adapter, overrides: null });
var descriptor = buildDevelopDescriptor();
var run = wf;
export {
  run,
  descriptor
};
