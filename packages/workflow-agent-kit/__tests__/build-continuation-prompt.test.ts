import type { StepContext } from "@uncaged/workflow-protocol";
import { describe, expect, test } from "vitest";
import { buildContinuationPrompt } from "../src/build-continuation-prompt.js";

const reviewerStep: StepContext = {
  role: "reviewer",
  output: { approved: false, comments: "Missing tests" },
  detail: "2MXBG6PN4A8JR",
  agent: "uwf-hermes",
  edgePrompt: "Review the developer's work.",
};

const developerStep: StepContext = {
  role: "developer",
  output: { filesChanged: ["src/app.ts"], summary: "Initial fix" },
  detail: "1VPBG9SM5E7WK",
  agent: "uwf-hermes",
  edgePrompt: "Implement the fix.",
};

describe("buildContinuationPrompt", () => {
  test("includes steps after the last matching role and the edge prompt", () => {
    const steps: StepContext[] = [
      developerStep,
      reviewerStep,
      {
        role: "planner",
        output: { plan: "revise approach" },
        detail: "7BQST3VW9F2MA",
        agent: "uwf-hermes",
        edgePrompt: "Revise the plan.",
      },
    ];

    const result = buildContinuationPrompt(
      steps,
      "developer",
      "The reviewer rejected your implementation. Read their feedback and fix the issues.",
    );

    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("### Step 2: reviewer");
    expect(result).toContain("Missing tests");
    expect(result).toContain("### Step 3: planner");
    expect(result).toContain("## Moderator Instruction");
    expect(result).toContain("The reviewer rejected your implementation.");
    expect(result).not.toContain("Initial fix");
  });

  test("uses all steps when the role has not run before", () => {
    const result = buildContinuationPrompt(
      [developerStep, reviewerStep],
      "planner",
      "Continue from the reviewer feedback.",
    );

    expect(result).toContain("### Step 1: developer");
    expect(result).toContain("### Step 2: reviewer");
    expect(result).toContain("Continue from the reviewer feedback.");
  });

  test("still includes moderator instruction when there are no intervening steps", () => {
    const result = buildContinuationPrompt(
      [developerStep],
      "developer",
      "Please revise your work.",
    );

    expect(result).not.toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("## Moderator Instruction");
    expect(result).toContain("Please revise your work.");
  });
});
