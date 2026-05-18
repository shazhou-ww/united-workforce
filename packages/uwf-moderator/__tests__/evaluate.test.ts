import { describe, expect, test } from "bun:test";
import type { ModeratorContext, WorkflowPayload } from "@uncaged/uwf-protocol";

import { evaluate } from "../src/evaluate.js";

const solveIssueWorkflow: WorkflowPayload = {
  name: "solve-issue",
  description: "End-to-end issue resolution",
  roles: {
    planner: {
      description: "Creates implementation plan",
      systemPrompt: "You are a planning agent...",
      outputSchema: "5GWKR8TN1V3JA",
    },
    developer: {
      description: "Implements code changes",
      systemPrompt: "You are a developer agent...",
      outputSchema: "8CNWT4KR6D1HV",
    },
    reviewer: {
      description: "Reviews code changes",
      systemPrompt: "You are a code reviewer...",
      outputSchema: "1VPBG9SM5E7WK",
    },
  },
  conditions: {
    needsClarification: {
      description: "Planner requests clarification from user",
      expression: "$exists(steps[-1].output.needsClarification)",
    },
    notApproved: {
      description: "Reviewer rejected the implementation",
      expression: "steps[-1].output.approved = false",
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
      { role: "developer", condition: "notApproved" },
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

  test("condition match (notApproved → developer)", async () => {
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
});
