import { describe, expect, test } from "vitest";
import { buildFrontmatterRetryPrompt } from "../src/frontmatter-retry-prompt.js";

describe("buildFrontmatterRetryPrompt", () => {
  test("includes correction instruction", () => {
    const result = buildFrontmatterRetryPrompt("Use YAML frontmatter");
    expect(result).toContain("previous run completed");
    expect(result).toContain("do NOT need to redo any work");
    expect(result).toContain("corrected YAML frontmatter");
  });

  test("includes outputFormatInstruction when provided", () => {
    const instruction = "---\nstatus: $done | $review\nsummary: string\n---";
    const result = buildFrontmatterRetryPrompt(instruction);
    expect(result).toContain(instruction);
  });

  test("works with empty outputFormatInstruction", () => {
    const result = buildFrontmatterRetryPrompt("");
    expect(result).not.toContain("\n\n\n");
    expect(result).toContain("corrected YAML frontmatter");
  });
});
