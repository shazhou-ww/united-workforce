import type { ThreadId } from "@united-workforce/protocol";
import type { AgentContext } from "@united-workforce/util-agent";
import { describe, expect, test } from "vitest";
import { buildClaudeCodePrompt, mapClaudeError } from "../src/claude-code.js";

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
    storageRoot: "/tmp/uwf-test",
    casDir: "/tmp/ocas-test",
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

describe("mapClaudeError", () => {
  test("maps `Not logged in` stderr to actionable login message", () => {
    const stderr = "Not logged in · Please run /login";
    const message = mapClaudeError(1, stderr);
    expect(message).toContain("Claude Code is not logged in. Run `claude login` first.");
  });

  test("matches `Not logged in` case-insensitively", () => {
    const stderr = "ERROR: not logged in to claude";
    const message = mapClaudeError(1, stderr);
    expect(message).toContain("Claude Code is not logged in. Run `claude login` first.");
  });

  test("maps API key errors to actionable API key message", () => {
    const cases = [
      "Error: invalid api key",
      "ANTHROPIC_API_KEY not set",
      "authentication failed",
      "401 unauthorized",
    ];
    for (const stderr of cases) {
      const message = mapClaudeError(1, stderr);
      expect(message).toContain("Claude Code API key error. Check your API key configuration.");
    }
  });

  test("includes exit code and truncated stderr for unmatched non-zero exit", () => {
    const stderr = "Some random failure that we don't recognise";
    const message = mapClaudeError(2, stderr);
    expect(message).toContain("claude exited with code 2");
    expect(message).toContain("Some random failure that we don't recognise");
  });

  test("truncates very long stderr", () => {
    const stderr = "x".repeat(2000);
    const message = mapClaudeError(2, stderr);
    expect(message.length).toBeLessThan(1000);
    expect(message).toContain("claude exited with code 2");
  });

  test("handles empty stderr by reporting only the exit code", () => {
    const message = mapClaudeError(1, "");
    expect(message).toContain("claude exited with code 1");
  });

  test("handles null exit code", () => {
    const message = mapClaudeError(null, "killed by signal");
    expect(message).toContain("claude exited with code null");
    expect(message).toContain("killed by signal");
  });

  test("never echoes the assembled prompt body", () => {
    // Even if the stderr accidentally contained prompt-like content,
    // the mapping helper does not see the prompt. Sanity check: the
    // helper only takes (exitCode, stderr) and `## Task` must not
    // appear in the mapped message because we don't pass it.
    const message = mapClaudeError(1, "Not logged in · Please run /login");
    expect(message).not.toContain("## Task");
  });

  test("error message stays under 1000 chars even with API key match plus long stderr", () => {
    const stderr = `invalid api key\n${"y".repeat(5000)}`;
    const message = mapClaudeError(1, stderr);
    expect(message.length).toBeLessThan(1000);
    expect(message).toContain("Claude Code API key error.");
  });
});
