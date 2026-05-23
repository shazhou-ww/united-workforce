import { describe, expect, test } from "bun:test";

import type { AgentContext } from "@uncaged/workflow-agent-kit";

import { buildBuiltinPrompt } from "../src/prompt.js";

function minimalContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    threadId: "00000000000000000000000000" as AgentContext["threadId"],
    role: "developer",
    store: {} as AgentContext["store"],
    workflow: {
      name: "test",
      roles: {
        developer: {
          goal: "Ship the fix",
          capabilities: ["file-edit"],
          procedure: ["Edit files"],
          output: "A patch",
          frontmatter: "schema-hash",
        },
      },
      conditions: {},
      graph: {},
    },
    start: { workflow: "wf-hash", prompt: "Fix the bug" },
    steps: [],
    outputFormatInstruction: "---\nstatus: done\n---",
    ...overrides,
  };
}

describe("buildBuiltinPrompt", () => {
  test("includes output format, task, and role goal", () => {
    const prompt = buildBuiltinPrompt(minimalContext());
    expect(prompt).toContain("status: done");
    expect(prompt).toContain("## Goal");
    expect(prompt).toContain("Ship the fix");
    expect(prompt).toContain("## Task");
    expect(prompt).toContain("Fix the bug");
  });

  test("includes history when steps exist", () => {
    const prompt = buildBuiltinPrompt(
      minimalContext({
        steps: [
          {
            role: "planner",
            output: { plan: "step 1" },
            agent: "uwf-builtin",
            detail: "detail-hash",
          },
        ],
      }),
    );
    expect(prompt).toContain("## Previous Steps");
    expect(prompt).toContain("planner");
  });
});
