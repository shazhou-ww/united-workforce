import { describe, expect, test } from "bun:test";
import type { StepContext } from "@uncaged/workflow-protocol";
import { buildContinuationPrompt } from "../src/build-continuation-prompt.js";

const reviewerStep: StepContext = {
  role: "reviewer",
  output: { approved: false, comments: "Missing tests" },
  detail: "2MXBG6PN4A8JR",
  agent: "uwf-hermes",
  edgePrompt: "Review the developer's work.",
  content: null,
};

const developerStep: StepContext = {
  role: "developer",
  output: { filesChanged: ["src/app.ts"], summary: "Initial fix" },
  detail: "1VPBG9SM5E7WK",
  agent: "uwf-hermes",
  edgePrompt: "Implement the fix.",
  content: null,
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
        content: null,
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

  test("includes step content when includeContent option is true", () => {
    const stepsWithContent: StepContext[] = [
      {
        role: "planner",
        output: { plan: "hash123" },
        detail: "detail1",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Plan\nDetailed plan markdown...",
      },
      {
        role: "developer",
        output: { filesChanged: ["app.ts"] },
        detail: "detail2",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Implementation\nCode changes...",
      },
      {
        role: "reviewer",
        output: { approved: false },
        detail: "detail3",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Review\nFeedback...",
      },
    ];

    const result = buildContinuationPrompt(stepsWithContent, "committer", "Commit the changes.", {
      includeContent: true,
    });

    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("### Step 1: planner");
    expect(result).toContain("#### Step Content");
    expect(result).toContain("# Plan");
    expect(result).toContain("Detailed plan markdown");
    expect(result).toContain("### Step 2: developer");
    expect(result).toContain("# Implementation");
    expect(result).toContain("### Step 3: reviewer");
    expect(result).toContain("# Review");
    expect(result).toContain("## Moderator Instruction");
    expect(result).toContain("Commit the changes.");
  });

  test("omits step content when includeContent is false (default)", () => {
    const stepsWithContent: StepContext[] = [
      {
        role: "developer",
        output: { filesChanged: ["app.ts"] },
        detail: "detail1",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Implementation\nCode changes...",
      },
      {
        role: "reviewer",
        output: { approved: false },
        detail: "detail2",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Review\nFeedback...",
      },
    ];

    const result = buildContinuationPrompt(stepsWithContent, "developer", "Fix the issues.");

    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("### Step 2: reviewer");
    expect(result).toContain(JSON.stringify(stepsWithContent[1]?.output));
    expect(result).not.toContain("#### Step Content");
    expect(result).not.toContain("# Review");
  });

  test("respects quota when includeContent is true", () => {
    const largeContent = "x".repeat(5000);
    const stepsWithContent: StepContext[] = [
      {
        role: "planner",
        output: { plan: "hash1" },
        detail: "detail1",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: largeContent,
      },
      {
        role: "developer",
        output: { files: ["app.ts"] },
        detail: "detail2",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: largeContent,
      },
      {
        role: "reviewer",
        output: { approved: true },
        detail: "detail3",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Review\nLooks good!",
      },
    ];

    const result = buildContinuationPrompt(stepsWithContent, "committer", "Commit the changes.", {
      includeContent: true,
      quota: 1000,
    });

    // Should include most recent step(s) within quota
    expect(result).toContain("### Step 1: reviewer"); // Showing 1 of 3, so step 3 becomes step 1
    expect(result).toContain("#### Step Content");
    expect(result).toContain("## Moderator Instruction");
    expect(result).toContain("Showing 1 of 3 steps (2 omitted due to quota)");
  });

  test("handles null content gracefully when includeContent is true", () => {
    const stepsWithMixedContent: StepContext[] = [
      {
        role: "planner",
        output: { plan: "hash1" },
        detail: "detail1",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Plan\nDetails...",
      },
      {
        role: "developer",
        output: { files: ["app.ts"] },
        detail: "detail2",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: null, // No content available
      },
      {
        role: "reviewer",
        output: { approved: true },
        detail: "detail3",
        agent: "uwf-hermes",
        edgePrompt: "",
        content: "# Review\nApproved!",
      },
    ];

    const result = buildContinuationPrompt(
      stepsWithMixedContent,
      "committer",
      "Commit the changes.",
      { includeContent: true },
    );

    expect(result).toContain("### Step 1: planner");
    expect(result).toContain("# Plan");
    expect(result).toContain("### Step 2: developer");
    // Step 2 should not have content section since content is null
    expect(result).toContain("### Step 3: reviewer");
    expect(result).toContain("# Review");
  });
});
