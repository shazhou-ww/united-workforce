import { describe, expect, test } from "bun:test";
import type { ModeratorContext, WorkflowPayload } from "@uncaged/workflow-protocol";

import { evaluate } from "../src/evaluate.js";

const solveIssueWorkflow: WorkflowPayload = {
  name: "solve-issue",
  description: "End-to-end issue resolution",
  roles: {
    planner: {
      description: "Creates implementation plan",
      goal: "You are a planning agent.",
      capabilities: ["planning"],
      procedure: "Create a step-by-step plan.",
      output: "Output the plan and steps.",
      frontmatter: "5GWKR8TN1V3JA",
    },
    developer: {
      description: "Implements code changes",
      goal: "You are a developer agent.",
      capabilities: ["coding"],
      procedure: "Implement the plan.",
      output: "List files changed and summary.",
      frontmatter: "8CNWT4KR6D1HV",
    },
    reviewer: {
      description: "Reviews code changes",
      goal: "You are a code reviewer.",
      capabilities: ["code-review"],
      procedure: "Review the implementation.",
      output: "Approve or reject with comments.",
      frontmatter: "1VPBG9SM5E7WK",
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
    $START: [
      {
        role: "planner",
        condition: null,
        prompt: "Start planning from the issue in the task.",
      },
    ],
    planner: [
      {
        role: "developer",
        condition: "needsClarification",
        prompt: "Clarification is needed; hand off to developer.",
      },
      { role: "$END", condition: null, prompt: "Planning complete; end workflow." },
    ],
    developer: [
      {
        role: "reviewer",
        condition: null,
        prompt: "Implementation done; send to reviewer.",
      },
    ],
    reviewer: [
      {
        role: "developer",
        condition: "rejected",
        prompt: "Reviewer rejected; return to developer.",
      },
      { role: "$END", condition: null, prompt: "Review passed; end workflow." },
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
    expect(result).toEqual({
      ok: true,
      value: { role: "planner", prompt: "Start planning from the issue in the task." },
    });
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
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Reviewer rejected; return to developer." },
    });
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
    expect(result).toEqual({
      ok: true,
      value: { role: "$END", prompt: "Review passed; end workflow." },
    });
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
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Clarification is needed; hand off to developer." },
    });
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
        $START: [
          {
            role: "developer",
            condition: null,
            prompt: "Begin development.",
          },
        ],
        developer: [
          { role: "$END", condition: "devFailed", prompt: "Development failed; end." },
          {
            role: "reviewer",
            condition: null,
            prompt: "Development succeeded; review.",
          },
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
    expect(result).toEqual({
      ok: true,
      value: { role: "$END", prompt: "Development failed; end." },
    });
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
        $START: [
          {
            role: "planner",
            condition: null,
            prompt: "Begin planning.",
          },
        ],
        planner: [
          { role: "$END", condition: "firstPlanReady", prompt: "First plan was ready; end." },
          {
            role: "developer",
            condition: null,
            prompt: "Plan not ready on first pass; implement.",
          },
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
    expect(result).toEqual({
      ok: true,
      value: { role: "$END", prompt: "First plan was ready; end." },
    });
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
        $START: [
          {
            role: "planner",
            condition: null,
            prompt: "Begin planning.",
          },
        ],
        planner: [
          { role: "$END", condition: "hasReviewer", prompt: "Reviewer already ran; end." },
          {
            role: "developer",
            condition: null,
            prompt: "No reviewer yet; implement.",
          },
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
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "No reviewer yet; implement." },
    });
  });
});
