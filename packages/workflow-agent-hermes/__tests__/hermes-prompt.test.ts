import { describe, expect, test } from "bun:test";
import type { AgentContext } from "@uncaged/workflow-agent-kit";
import type { ThreadId } from "@uncaged/workflow-protocol";
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
    start: { prompt: "Fix the bug", workflowHash: "abc123", threadId: "t1" },
    steps: [],
    store: {} as AgentContext["store"],
    outputFormatInstruction: "Use YAML frontmatter",
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
        },
        {
          role: "reviewer",
          output: { approved: false },
          agent: "uwf-hermes",
          detail: "detail-2",
          edgePrompt: "Review the code.",
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
          },
        ],
        edgePrompt: "Retry with a fresh approach.",
      }),
    );

    expect(result).toContain("## Task");
    expect(result).toContain("Retry with a fresh approach.");
    expect(result).not.toContain("## What Happened Since Your Last Turn");
  });
});
