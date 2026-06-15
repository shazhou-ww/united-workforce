import type { ThreadId } from "@united-workforce/protocol";
import type { AgentContext } from "@united-workforce/util-agent";
import { describe, expect, test } from "vitest";
import { buildHermesPrompt } from "../src/hermes.js";

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    threadId: "01JTEST0000000000000000000" as ThreadId,
    edgePrompt: "Proceed with the assigned role.",
    isFirstVisit: true,
    workflow: {
      roles: {
        developer: {
          description: "TDD implementation per test spec",
          goal: "Write code",
          capabilities: ["coding"],
          procedure: "1. Read spec\n2. Write code",
          output: "List files changed",
          frontmatter: "",
        },
      },
      conditions: {},
      graph: {},
    },
    role: "developer",
    start: { prompt: "Fix the bug", workflow: "abc123" },
    steps: [],
    store: {} as AgentContext["store"],
    outputFormatInstruction: "Use YAML frontmatter",
    storageRoot: "/tmp/uwf-test",
    casDir: "/tmp/ocas-test",
    ...overrides,
  };
}

describe("buildHermesPrompt", () => {
  test("first visit uses full role prompt and includes moderator instruction", () => {
    const result = buildHermesPrompt(
      makeCtx({ edgePrompt: "Focus on the failing test.", isFirstVisit: true }),
    );

    expect(result).toMatch(/^Use YAML frontmatter/);
    expect(result).toContain("Write code");
    expect(result).toContain("## Task\nFix the bug");
    expect(result).toContain("## Moderator Instruction");
    expect(result).toContain("Focus on the failing test.");
  });

  test("re-entry uses continuation prompt with edge instruction", () => {
    const ctx = makeCtx({
      isFirstVisit: false,
      edgePrompt: "The reviewer rejected your work. Fix the issues.",
      steps: [
        {
          role: "developer",
          output: { summary: "Initial fix" },
          agent: "uwf-hermes",
          detail: "detail-1",
          edgePrompt: "Implement the fix.",
          content: null,
        },
        {
          role: "reviewer",
          output: { approved: false },
          agent: "uwf-hermes",
          detail: "detail-2",
          edgePrompt: "Review the code.",
          content: null,
        },
      ],
    });

    const result = buildHermesPrompt(ctx);

    expect(result).not.toContain("## Task");
    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("## Moderator Instruction");
    expect(result).toContain("The reviewer rejected your work.");
  });

  test("forced first visit via isFirstVisit uses initial prompt even when role appears in history", () => {
    const result = buildHermesPrompt(
      makeCtx({
        isFirstVisit: true,
        steps: [
          {
            role: "developer",
            output: { done: true },
            agent: "uwf-hermes",
            detail: "detail-1",
            edgePrompt: "First attempt.",
            content: null,
          },
        ],
        edgePrompt: "Retry with a fresh approach.",
      }),
    );

    expect(result).toContain("## Task");
    expect(result).toContain("Retry with a fresh approach.");
    expect(result).not.toContain("## What Happened Since Your Last Turn");
  });

  test("first visit includes content from previous steps", () => {
    const ctx = makeCtx({
      isFirstVisit: true,
      steps: [
        {
          role: "planner",
          output: { plan: "hash1" },
          agent: "uwf-hermes",
          detail: "detail-1",
          edgePrompt: "Create the plan.",
          content: "# Plan\nDetailed plan markdown...",
        },
        {
          role: "developer",
          output: { files: ["app.ts"] },
          agent: "uwf-hermes",
          detail: "detail-2",
          edgePrompt: "Implement the code.",
          content: "# Implementation\nCode changes...",
        },
        {
          role: "reviewer",
          output: { approved: true },
          agent: "uwf-hermes",
          detail: "detail-3",
          edgePrompt: "Review the work.",
          content: "# Review\nApproved!",
        },
      ],
      role: "committer",
      edgePrompt: "Commit the reviewed code.",
    });

    const result = buildHermesPrompt(ctx);

    expect(result).toContain("Use YAML frontmatter");
    expect(result).toContain("## Task");
    expect(result).toContain("Fix the bug");
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
    expect(result).toContain("Commit the reviewed code.");
  });

  test("re-entry omits content from previous steps", () => {
    const ctx = makeCtx({
      isFirstVisit: false,
      steps: [
        {
          role: "developer",
          output: { files: ["app.ts"] },
          agent: "uwf-hermes",
          detail: "detail-1",
          edgePrompt: "Implement the code.",
          content: "# Implementation\nCode changes...",
        },
        {
          role: "reviewer",
          output: { approved: false },
          agent: "uwf-hermes",
          detail: "detail-2",
          edgePrompt: "Review the work.",
          content: "# Review\nNot approved!",
        },
      ],
      role: "developer",
      edgePrompt: "Fix the issues.",
    });

    const result = buildHermesPrompt(ctx);

    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("### Step 2: reviewer");
    expect(result).toContain(JSON.stringify({ approved: false }));
    expect(result).not.toContain("#### Step Content");
    expect(result).not.toContain("# Review");
    expect(result).not.toContain("Not approved!");
  });
});
