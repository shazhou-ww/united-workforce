import { createMemoryStore } from "@ocas/core";
import { describe, expect, test } from "vitest";
import { processClaudeOutput } from "../src/claude-code.js";

/**
 * Build a Claude Code stream-json (NDJSON) stdout with a `result` line of the
 * given subtype. Mirrors the shape `parseClaudeCodeStreamOutput` expects.
 */
function buildStreamOutput(subtype: string): string {
  const system = JSON.stringify({
    type: "system",
    session_id: "sess-abc",
    model: "claude-test",
  });
  const assistant = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "working..." }] },
  });
  const result = JSON.stringify({
    type: "result",
    subtype,
    session_id: "sess-abc",
    result: "partial work output",
    num_turns: 90,
    duration_ms: 12000,
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  return `${system}\n${assistant}\n${result}\n`;
}

describe("claude-code adapter: suspend on max turns", () => {
  test("error_max_turns yields a $SUSPEND frontmatter output", async () => {
    const store = createMemoryStore();
    const stdout = buildStreamOutput("error_max_turns");

    const result = await processClaudeOutput(stdout, "", 0, store, "the-prompt");

    expect(result.output).toContain("$status: $SUSPEND");
    expect(result.output).toContain("reason: max turns (90) reached");
    // Turns and usage are preserved from the run.
    expect(result.usage).toEqual({
      turns: 90,
      inputTokens: 100,
      outputTokens: 50,
      duration: 12,
    });
    expect(result.assembledPrompt).toBe("the-prompt");
    expect(result.sessionId).toBe("sess-abc");
  });

  test("success subtype returns the normal assistant output (no suspend)", async () => {
    const store = createMemoryStore();
    const stdout = buildStreamOutput("success");

    const result = await processClaudeOutput(stdout, "", 0, store, "the-prompt");

    expect(result.output).toBe("partial work output");
    expect(result.output).not.toContain("$SUSPEND");
  });
});
