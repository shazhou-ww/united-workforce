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
    edgePrompt: "Implement the fix described in the plan.",
    isFirstVisit: true,
    ...overrides,
  };
}

describe("buildBuiltinPrompt", () => {
  test("system includes output format and role goal", () => {
    const { system } = buildBuiltinPrompt(minimalContext());
    expect(system).toContain("status: done");
    expect(system).toContain("## Goal");
    expect(system).toContain("Ship the fix");
  });

  test("user includes task and edge prompt", () => {
    const { user } = buildBuiltinPrompt(minimalContext());
    expect(user).toContain("## Task");
    expect(user).toContain("Fix the bug");
    expect(user).toContain("## Current Step Instruction");
    expect(user).toContain("Implement the fix");
  });

  test("user includes history when steps exist", () => {
    const { user } = buildBuiltinPrompt(
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
    expect(user).toContain("## Previous Steps");
    expect(user).toContain("planner");
  });
});
