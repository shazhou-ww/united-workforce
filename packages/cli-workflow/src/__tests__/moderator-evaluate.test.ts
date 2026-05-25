import { describe, expect, test } from "vitest";
import type { Target, WorkflowPayload } from "@uncaged/workflow-protocol";

import { evaluate } from "../moderator/evaluate.js";

const solveIssueGraph: WorkflowPayload["graph"] = {
  $START: {
    _: { role: "planner", prompt: "Start planning from the issue in the task." },
  },
  planner: {
    _: { role: "developer", prompt: "Implement the plan: {{plan}}" },
  },
  developer: {
    _: { role: "reviewer", prompt: "Review the changes: {{summary}}" },
  },
  reviewer: {
    approved: { role: "$END", prompt: "Done." },
    rejected: { role: "developer", prompt: "Fix: {{comments}}" },
  },
};

describe("evaluate", () => {
  test("$START → first role (unit status _)", () => {
    const result = evaluate(solveIssueGraph, "$START", { $status: "_" });
    expect(result).toEqual({
      ok: true,
      value: { role: "planner", prompt: "Start planning from the issue in the task." },
    });
  });

  test("status-based routing (reviewer rejected → developer)", () => {
    const result = evaluate(solveIssueGraph, "reviewer", {
      $status: "rejected",
      comments: "missing tests",
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Fix: missing tests" },
    });
  });

  test("status-based routing (reviewer approved → $END)", () => {
    const result = evaluate(solveIssueGraph, "reviewer", { $status: "approved" });
    expect(result).toEqual({
      ok: true,
      value: { role: "$END", prompt: "Done." },
    });
  });

  test("missing role in graph → error", () => {
    const result = evaluate(solveIssueGraph, "unknown-role", { $status: "_" });
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
      $status: "_",
      plan: "Add auth middleware",
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Implement the plan: Add auth middleware" },
    });
  });

  test("mustache does not HTML-escape prompt content", () => {
    const result = evaluate(solveIssueGraph, "reviewer", {
      $status: "rejected",
      comments: 'use <T> & "Result<T, E>" types',
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: 'Fix: use <T> & "Result<T, E>" types' },
    });
  });

  test("triple mustache also works for unescaped output", () => {
    const graph: Record<string, Record<string, Target>> = {
      reviewer: {
        _: { role: "developer", prompt: "Fix: {{{comments}}}" },
      },
    };
    const result = evaluate(graph, "reviewer", {
      $status: "_",
      comments: "<script>alert(1)</script>",
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Fix: <script>alert(1)</script>" },
    });
  });

  test("missing $status defaults to _ (unit routing)", () => {
    const result = evaluate(solveIssueGraph, "planner", {
      plan: "Add auth middleware",
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Implement the plan: Add auth middleware" },
    });
  });

  test("mustache template with nested object paths", () => {
    const graph: Record<string, Record<string, Target>> = {
      reviewer: {
        _: {
          role: "developer",
          prompt: "Address: {{review.comments}}",
        },
      },
    };
    const result = evaluate(graph, "reviewer", {
      $status: "_",
      review: { comments: "refactor the handler" },
    });
    expect(result).toEqual({
      ok: true,
      value: { role: "developer", prompt: "Address: refactor the handler" },
    });
  });
});
