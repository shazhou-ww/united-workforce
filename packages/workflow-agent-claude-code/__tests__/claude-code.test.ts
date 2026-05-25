import { describe, expect, test } from "bun:test";
import type { AgentContext } from "@uncaged/workflow-agent-kit";
import type { ThreadId } from "@uncaged/workflow-protocol";
import { buildClaudeCodePrompt } from "../src/claude-code.js";

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

describe("buildClaudeCodePrompt", () => {
  test("assembles outputFormatInstruction + role prompt + task prompt", () => {
    const result = buildClaudeCodePrompt(makeCtx());
    expect(result).toMatch(/^Use YAML frontmatter/);
    expect(result).toContain("Write code");
    expect(result).toContain("## Task\nFix the bug");
  });

  test("includes previous steps with content on first visit", () => {
    const ctx = makeCtx({
      steps: [
        {
          role: "planner",
          output: '{"plan":"do X"}',
          agent: "hermes",
          detail: "detail-1",
          edgePrompt: "Create a plan.",
          content: "Here is my detailed plan for doing X.",
        },
      ],
    });
    const result = buildClaudeCodePrompt(ctx);
    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("Step 1: planner");
    expect(result).toContain("do X");
    // First visit should include step content
    expect(result).toContain("Here is my detailed plan for doing X.");
  });

  test("re-entry shows steps since last visit without content", () => {
    const ctx = makeCtx({
      isFirstVisit: false,
      steps: [
        {
          role: "developer",
          output: '{"status":"done"}',
          agent: "claude-code",
          detail: "detail-1",
          edgePrompt: "Implement.",
          content: "I implemented everything.",
        },
        {
          role: "reviewer",
          output: '{"approved":false}',
          agent: "claude-code",
          detail: "detail-2",
          edgePrompt: "Review.",
          content: "Rejected: complexity too high, refactor cmdStepRead.",
        },
      ],
    });
    const result = buildClaudeCodePrompt(ctx);
    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("reviewer");
    expect(result).toContain("approved");
  });

  test("omits history section when steps array is empty", () => {
    const result = buildClaudeCodePrompt(makeCtx({ steps: [] }));
    expect(result).not.toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("## Current Instruction");
  });

  test("works without outputFormatInstruction", () => {
    const result = buildClaudeCodePrompt(makeCtx({ outputFormatInstruction: "" }));
    expect(result).not.toMatch(/^\s*\n/);
    expect(result).toContain("Write code");
    expect(result).toContain("## Task");
  });
});
