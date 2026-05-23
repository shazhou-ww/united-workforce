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

  test("includes previous steps as history summary", () => {
    const ctx = makeCtx({
      steps: [{ role: "planner", output: '{"plan":"do X"}', agent: "hermes" }],
    });
    const result = buildClaudeCodePrompt(ctx);
    expect(result).toContain("## Previous Steps");
    expect(result).toContain("Step 1: planner");
    expect(result).toContain("do X");
  });

  test("omits history section when steps array is empty", () => {
    const result = buildClaudeCodePrompt(makeCtx({ steps: [] }));
    expect(result).not.toContain("## Previous Steps");
  });

  test("works without outputFormatInstruction", () => {
    const result = buildClaudeCodePrompt(makeCtx({ outputFormatInstruction: "" }));
    expect(result).not.toMatch(/^\s*\n/);
    expect(result).toContain("Write code");
    expect(result).toContain("## Task");
  });
});
