import { describe, expect, test } from "bun:test";
import type { ModeratorContext, WorkflowPayload } from "@uncaged/workflow-protocol";

import { evaluate } from "../src/evaluate.js";

const solveIssueWorkflow: WorkflowPayload = {
  name: "solve-issue",
  description: "End-to-end issue resolution",
  roles: {
    planner: {
      description: "Creates implementation plan",
      identity: "You are a planning agent.",
      prepare: "Review the issue context.",
      execute: "Create a step-by-step plan.",
      report: "Output the plan and steps.",
      outputSchema: "5GWKR8TN1V3JA",
    },
    developer: {
      description: "Implements code changes",
      identity: "You are a developer agent.",
      prepare: "Load coding tools.",
      execute: "Implement the plan.",
      report: "List files changed and summary.",
      outputSchema: "8CNWT4KR6D1HV",
    },
    reviewer: {
      description: "Reviews code changes",
      identity: "You are a code reviewer.",
      prepare: "Review project conventions.",
      execute: "Review the implementation.",
      report: "Approve or reject with comments.",
      outputSchema: "1VPBG9SM5E7WK",
    },
  },
  conditions: {
    needsClarification: {
      description: "Planner requests clarification from user",
      expression: "$exists($last('planner').needsClarification)",
    },
    rejected: {
      description: "Reviewer rejected the implementation",
      expression: "$last('reviewer').approved = false",
    },
  },
  graph: {
    $START: [{ role: "planner", condition: null }],
    planner: [
      { role: "developer", condition: "needsClarification" },
      { role: "$END", condition: null },
    ],
    developer: [{ role: "reviewer", condition: null }],
    reviewer: [
      { role: "developer", condition: "rejected" },
      { role: "$END", condition: null },
    ],
  },
};

function makeContext(steps: ModeratorContext["steps"]): ModeratorContext {
  return {
    start: {
      workflow: "4KNM2PXR3B1QW",
      prompt: "Fix the login bug",
    },
    steps,
  };
}

describe("evaluate", () => {
  test("$START → first role (fallback)", async () => {
    const result = await evaluate(solveIssueWorkflow, makeContext([]));
    expect(result).toEqual({ ok: true, value: "planner" });
  });

  test("condition match (rejected → developer)", async () => {
    const context = makeContext([
      {
        role: "reviewer",
        output: { approved: false },
        detail: "2MXBG6PN4A8JR",
        agent: "uwf-hermes",
      },
    ]);
    const result = await evaluate(solveIssueWorkflow, context);
    expect(result).toEqual({ ok: true, value: "developer" });
  });

  test("fallback when condition does not match → $END", async () => {
    const context = makeContext([
      {
        role: "reviewer",
        output: { approved: true },
        detail: "2MXBG6PN4A8JR",
        agent: "uwf-hermes",
      },
    ]);
    const result = await evaluate(solveIssueWorkflow, context);
    expect(result).toEqual({ ok: true, value: "$END" });
  });

  test("missing role in graph → error", async () => {
    const context = makeContext([
      {
        role: "unknown-role",
        output: {},
        detail: "2MXBG6PN4A8JR",
        agent: "uwf-hermes",
      },
    ]);
    const result = await evaluate(solveIssueWorkflow, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('no transitions defined for role "unknown-role"');
    }
  });

  test("output expansion in context works with JSONata", async () => {
    const context = makeContext([
      {
        role: "planner",
        output: { needsClarification: true },
        detail: "7BQST3VW9F2MA",
        agent: "uwf-hermes",
      },
    ]);
    const result = await evaluate(solveIssueWorkflow, context);
    expect(result).toEqual({ ok: true, value: "developer" });
  });

  test("$last returns most recent matching role's frontmatter", async () => {
    const workflow: WorkflowPayload = {
      ...solveIssueWorkflow,
      conditions: {
        devFailed: {
          description: "Developer failed",
          expression: "$last('developer').status = 'failed'",
        },
      },
      graph: {
        $START: [{ role: "developer", condition: null }],
        developer: [
          { role: "$END", condition: "devFailed" },
          { role: "reviewer", condition: null },
        ],
      },
    };
    const context = makeContext([
      {
        role: "developer",
        output: { status: "done" },
        detail: "1VPBG9SM5E7WK",
        agent: "uwf-hermes",
      },
      {
        role: "reviewer",
        output: { approved: false },
        detail: "2MXBG6PN4A8JR",
        agent: "uwf-hermes",
      },
      {
        role: "developer",
        output: { status: "failed" },
        detail: "3QNTH7WK8D2PA",
        agent: "uwf-hermes",
      },
    ]);
    const result = await evaluate(workflow, context);
    expect(result).toEqual({ ok: true, value: "$END" });
  });

  test("$first returns earliest matching role's frontmatter", async () => {
    const workflow: WorkflowPayload = {
      ...solveIssueWorkflow,
      conditions: {
        firstPlanReady: {
          description: "First planner run was ready",
          expression: "$first('planner').status = 'ready'",
        },
      },
      graph: {
        $START: [{ role: "planner", condition: null }],
        planner: [
          { role: "$END", condition: "firstPlanReady" },
          { role: "developer", condition: null },
        ],
      },
    };
    const context = makeContext([
      {
        role: "planner",
        output: { status: "ready", plan: "ABC123" },
        detail: "7BQST3VW9F2MA",
        agent: "uwf-hermes",
      },
      {
        role: "developer",
        output: { status: "done" },
        detail: "1VPBG9SM5E7WK",
        agent: "uwf-hermes",
      },
      {
        role: "planner",
        output: { status: "revised", plan: "DEF456" },
        detail: "4RNMK6PX8B3WQ",
        agent: "uwf-hermes",
      },
    ]);
    const result = await evaluate(workflow, context);
    expect(result).toEqual({ ok: true, value: "$END" });
  });

  test("$last returns undefined for unmatched role", async () => {
    const workflow: WorkflowPayload = {
      ...solveIssueWorkflow,
      conditions: {
        hasReviewer: {
          description: "Reviewer has run",
          expression: "$exists($last('reviewer'))",
        },
      },
      graph: {
        $START: [{ role: "planner", condition: null }],
        planner: [
          { role: "$END", condition: "hasReviewer" },
          { role: "developer", condition: null },
        ],
      },
    };
    const context = makeContext([
      {
        role: "planner",
        output: { status: "ready" },
        detail: "7BQST3VW9F2MA",
        agent: "uwf-hermes",
      },
    ]);
    const result = await evaluate(workflow, context);
    // no reviewer step → $exists returns false → fallback to developer
    expect(result).toEqual({ ok: true, value: "developer" });
  });
});
