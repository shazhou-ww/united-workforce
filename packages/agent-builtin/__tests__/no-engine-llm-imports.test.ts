import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("agent-builtin — no engine-level LLM imports (issue #143)", () => {
  test("agent.ts does not import resolveModel from util-agent", () => {
    const src = readFileSync(join(__dirname, "..", "src", "agent.ts"), "utf8");
    expect(src).not.toMatch(/resolveModel/);
  });

  test("agent.ts does not import loadWorkflowConfig from util-agent", () => {
    const src = readFileSync(join(__dirname, "..", "src", "agent.ts"), "utf8");
    expect(src).not.toMatch(/loadWorkflowConfig/);
  });

  test("llm/llm.ts imports ResolvedLlmProvider from local types, not util-agent", () => {
    const src = readFileSync(join(__dirname, "..", "src", "llm", "llm.ts"), "utf8");
    expect(src).not.toMatch(/from ["']@united-workforce\/util-agent["']/);
    expect(src).toMatch(/from ["']\.\/types\.js["']/);
  });

  test("loop.ts does not import ResolvedLlmProvider from util-agent", () => {
    const src = readFileSync(join(__dirname, "..", "src", "loop.ts"), "utf8");
    expect(src).not.toMatch(/from ["']@united-workforce\/util-agent["'][\s\S]*ResolvedLlmProvider/);
  });
});
