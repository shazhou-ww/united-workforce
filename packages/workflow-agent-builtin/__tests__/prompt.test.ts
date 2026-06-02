import { describe, expect, test } from "bun:test";

import type { AgentContext } from "@united-workforce/util-agent";

import { buildBuiltinMessages } from "../src/prompt.js";

function minimalContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    threadId: "00000000000000000000000000" as AgentContext["threadId"],
    role: "developer",
    store: {} as AgentContext["store"],
    workflow: {
      name: "test",
      description: "test workflow",
      roles: {
        developer: {
          description: "Developer role",
          goal: "Ship the fix",
          capabilities: ["file-edit"],
          procedure: "Edit files",
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

describe("buildBuiltinMessages", () => {
  test("system includes output format and role goal", () => {
    const messages = buildBuiltinMessages(minimalContext());
    const system = messages[0];
    expect(system?.role).toBe("system");
    if (system?.role === "system") {
      expect(system.content).toContain("status: done");
      expect(system.content).toContain("## Goal");
      expect(system.content).toContain("Ship the fix");
    }
  });

  test("first visit produces system + single user message with edge prompt", () => {
    const messages = buildBuiltinMessages(minimalContext());
    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("user");
    if (messages[1]?.role === "user") {
      expect(messages[1].content).toContain("Implement the fix");
      expect(messages[1].content).not.toContain("## What Happened Since Your Last Turn");
    }
  });

  test("first visit with prior steps includes inter-step summary in final user message", () => {
    const messages = buildBuiltinMessages(
      minimalContext({
        steps: [
          {
            role: "planner",
            output: { plan: "step 1" },
            agent: "uwf-builtin",
            detail: "detail-hash",
            edgePrompt: "Create a plan.",
          },
        ],
      }),
    );
    expect(messages).toHaveLength(2);
    const finalUser = messages[1];
    if (finalUser?.role === "user") {
      expect(finalUser.content).toContain("Implement the fix");
      expect(finalUser.content).toContain("## What Happened Since Your Last Turn");
      expect(finalUser.content).toContain("planner");
    }
  });

  test("re-entry reconstructs prior user/assistant turns plus current user message", () => {
    const messages = buildBuiltinMessages(
      minimalContext({
        isFirstVisit: false,
        edgePrompt: "Fix the reviewer's feedback.",
        steps: [
          {
            role: "developer",
            output: { summary: "Initial fix" },
            agent: "uwf-builtin",
            detail: "detail-1",
            edgePrompt: "Implement the fix.",
          },
          {
            role: "reviewer",
            output: { approved: false, comments: "Missing tests" },
            agent: "uwf-builtin",
            detail: "detail-2",
            edgePrompt: "Review the implementation.",
          },
        ],
      }),
    );

    expect(messages).toHaveLength(4);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(messages[2]?.role).toBe("assistant");
    expect(messages[3]?.role).toBe("user");

    if (messages[1]?.role === "user") {
      expect(messages[1].content).toBe("Implement the fix.");
    }
    if (messages[2]?.role === "assistant") {
      expect(messages[2].content).toBe(JSON.stringify({ summary: "Initial fix" }));
    }
    if (messages[3]?.role === "user") {
      expect(messages[3].content).toContain("Fix the reviewer's feedback.");
      expect(messages[3].content).toContain("## What Happened Since Your Last Turn");
      expect(messages[3].content).toContain("reviewer");
      expect(messages[3].content).toContain("Missing tests");
    }
  });

  test("prefix is stable across re-entry for LLM cache hits", () => {
    const firstVisitMessages = buildBuiltinMessages(
      minimalContext({
        edgePrompt: "Implement the fix.",
        steps: [],
      }),
    );

    const reEntryMessages = buildBuiltinMessages(
      minimalContext({
        isFirstVisit: false,
        edgePrompt: "Fix the reviewer's feedback.",
        steps: [
          {
            role: "developer",
            output: { summary: "Initial fix" },
            agent: "uwf-builtin",
            detail: "detail-1",
            edgePrompt: "Implement the fix.",
          },
          {
            role: "reviewer",
            output: { approved: false },
            agent: "uwf-builtin",
            detail: "detail-2",
            edgePrompt: "Review the code.",
          },
        ],
      }),
    );

    expect(reEntryMessages[0]).toEqual(firstVisitMessages[0]);
    expect(reEntryMessages[1]).toEqual(firstVisitMessages[1]);
    expect(reEntryMessages[2]?.role).toBe("assistant");
    if (reEntryMessages[2]?.role === "assistant") {
      expect(reEntryMessages[2].content).toBe(JSON.stringify({ summary: "Initial fix" }));
    }
    expect(reEntryMessages[3]?.role).toBe("user");
    if (reEntryMessages[3]?.role === "user") {
      expect(reEntryMessages[3].content).toContain("Fix the reviewer's feedback.");
    }
  });

  test("multiple prior visits emit one user/assistant pair per visit", () => {
    const messages = buildBuiltinMessages(
      minimalContext({
        isFirstVisit: false,
        edgePrompt: "Third round fix.",
        steps: [
          {
            role: "developer",
            output: { round: 1 },
            agent: "uwf-builtin",
            detail: "d1",
            edgePrompt: "First attempt.",
          },
          {
            role: "reviewer",
            output: { approved: false },
            agent: "uwf-builtin",
            detail: "d2",
            edgePrompt: "Review round 1.",
          },
          {
            role: "developer",
            output: { round: 2 },
            agent: "uwf-builtin",
            detail: "d3",
            edgePrompt: "Second attempt.",
          },
          {
            role: "reviewer",
            output: { approved: false },
            agent: "uwf-builtin",
            detail: "d4",
            edgePrompt: "Review round 2.",
          },
        ],
      }),
    );

    expect(messages).toHaveLength(6);
    expect(messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);

    if (messages[1]?.role === "user") {
      expect(messages[1].content).toBe("First attempt.");
    }
    if (messages[2]?.role === "assistant") {
      expect(messages[2].content).toBe(JSON.stringify({ round: 1 }));
    }
    if (messages[3]?.role === "user") {
      expect(messages[3].content).toContain("Second attempt.");
      expect(messages[3].content).toContain("reviewer");
    }
    if (messages[4]?.role === "assistant") {
      expect(messages[4].content).toBe(JSON.stringify({ round: 2 }));
    }
    if (messages[5]?.role === "user") {
      expect(messages[5].content).toContain("Third round fix.");
      expect(messages[5].content).toContain("### Step 4: reviewer");
      expect(messages[5].content).toContain('"approved":false');
    }
  });
});
