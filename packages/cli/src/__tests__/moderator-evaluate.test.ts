import type { Target, WorkflowPayload } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";

import { evaluate } from "../moderator/evaluate.js";

const solveIssueGraph: WorkflowPayload["graph"] = {
  $START: {
    new: { role: "planner", prompt: "Start planning from the issue in the task.", location: null },
    resume: {
      role: "planner",
      prompt: "Review the previous run output and continue the work.",
      location: null,
    },
  },
  planner: {
    planned: { role: "developer", prompt: "Implement the plan: {{plan}}", location: null },
  },
  developer: {
    implemented: { role: "reviewer", prompt: "Review the changes: {{summary}}", location: null },
  },
  reviewer: {
    approved: { role: "$END", prompt: "Done.", location: null },
    rejected: { role: "developer", prompt: "Fix: {{comments}}", location: null },
  },
};

describe("evaluate", () => {
  test("$START → first role (status new)", () => {
    const result = evaluate(solveIssueGraph, "$START", { $status: "new" });
    expect(result).toEqual({
      ok: true,
      value: {
        role: "planner",
        prompt: "Start planning from the issue in the task.",
        location: null,
      },
    });
  });

  test("$START → first role (status resume)", () => {
    const result = evaluate(solveIssueGraph, "$START", { $status: "resume" });
    expect(result).toEqual({
      ok: true,
      value: {
        role: "planner",
        prompt: "Review the previous run output and continue the work.",
        location: null,
      },
    });
  });

  test("status-based routing (reviewer rejected → developer)", () => {
    const result = evaluate(solveIssueGraph, "reviewer", {
      $status: "rejected",
      comments: "missing tests",
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Fix: missing tests", location: null },
    });
  });

  test("status-based routing (reviewer approved → $END)", () => {
    const result = evaluate(solveIssueGraph, "reviewer", { $status: "approved" });
    expect(result).toEqual({
      ok: true,
      value: { role: "$END", prompt: "Done.", location: null },
    });
  });

  test("status-based routing (needs input → $SUSPEND)", () => {
    const graph: Record<string, Record<string, Target>> = {
      ...solveIssueGraph,
      reviewer: {
        ...solveIssueGraph.reviewer,
        needs_input: { role: "$SUSPEND", prompt: "Waiting for user input.", location: null },
      },
    };
    const result = evaluate(graph, "reviewer", { $status: "needs_input" });
    expect(result).toEqual({
      ok: true,
      value: {
        action: "suspend",
        suspendedRole: "reviewer",
        prompt: "Waiting for user input.",
      },
    });
  });

  test("$SUSPEND prompt template renders mustache variables", () => {
    const graph: Record<string, Record<string, Target>> = {
      reviewer: {
        needs_input: {
          role: "$SUSPEND",
          prompt: "Please clarify: {{{question}}}",
          location: null,
        },
      },
    };
    const result = evaluate(graph, "reviewer", {
      $status: "needs_input",
      question: "Which API endpoint?",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        action: "suspend",
        suspendedRole: "reviewer",
        prompt: "Please clarify: Which API endpoint?",
      },
    });
  });

  test("missing role in graph → error", () => {
    const result = evaluate(solveIssueGraph, "unknown-role", { $status: "new" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('no transitions defined for role "unknown-role"');
    }
  });

  test("missing status in graph → error", () => {
    const result = evaluate(solveIssueGraph, "reviewer", { $status: "pending" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('no transition for role "reviewer" with status "pending"');
    }
  });

  test("mustache template rendering with simple fields", () => {
    const result = evaluate(solveIssueGraph, "planner", {
      $status: "planned",
      plan: "Add auth middleware",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        role: "developer",
        prompt: "Implement the plan: Add auth middleware",
        location: null,
      },
    });
  });

  test("mustache does not HTML-escape prompt content", () => {
    const result = evaluate(solveIssueGraph, "reviewer", {
      $status: "rejected",
      comments: 'use <T> & "Result<T, E>" types',
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: 'Fix: use <T> & "Result<T, E>" types', location: null },
    });
  });

  test("triple mustache also works for unescaped output", () => {
    const graph: Record<string, Record<string, Target>> = {
      reviewer: {
        rejected: { role: "developer", prompt: "Fix: {{{comments}}}", location: null },
      },
    };
    const result = evaluate(graph, "reviewer", {
      $status: "rejected",
      comments: "<script>alert(1)</script>",
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Fix: <script>alert(1)</script>", location: null },
    });
  });

  test("missing $status → error (no unit fallback)", () => {
    const result = evaluate(solveIssueGraph, "planner", {
      plan: "Add auth middleware",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        'agent output for role "planner" is missing required "$status" string',
      );
    }
  });

  test("mustache template with nested object paths", () => {
    const graph: Record<string, Record<string, Target>> = {
      reviewer: {
        rejected: {
          role: "developer",
          prompt: "Address: {{review.comments}}",
          location: null,
        },
      },
    };
    const result = evaluate(graph, "reviewer", {
      $status: "rejected",
      review: { comments: "refactor the handler" },
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Address: refactor the handler", location: null },
    });
  });
});
