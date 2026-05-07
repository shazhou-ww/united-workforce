import { describe, expect, test } from "bun:test";
import { START, type ThreadContext } from "@uncaged/workflow";

import { buildAgentPrompt } from "../src/index.js";

function startTask(content: string): ThreadContext["start"] {
  return {
    role: START,
    content,
    meta: { maxRounds: 5 },
    timestamp: 1,
  };
}

describe("buildAgentPrompt", () => {
  test("includes system prompt and full task; omits tools when there are no steps", () => {
    const ctx: ThreadContext = {
      start: startTask("fix the bug"),
      steps: [],
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: START, systemPrompt: "You are an agent." },
    };
    const text = buildAgentPrompt(ctx);
    expect(text).toContain("You are an agent.");
    expect(text).toContain("## Task");
    expect(text).toContain("fix the bug");
    expect(text).not.toContain("## Tools");
  });

  test("single step shows full content and meta, and includes tools", () => {
    const ctx: ThreadContext = {
      start: startTask("user task"),
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "Be helpful." },
      steps: [
        {
          role: "coder",
          content: "only step full body",
          meta: { files: ["a.ts"] },
          timestamp: 2,
        },
      ],
    };
    const text = buildAgentPrompt(ctx);
    expect(text).toContain("## Task");
    expect(text).toContain("user task");
    expect(text).toContain("## Step: coder");
    expect(text).toContain("only step full body");
    expect(text).toContain('Meta: {"files":["a.ts"]}');
    expect(text).toContain("## Tools");
    expect(text).toContain("uncaged-workflow thread 01TEST000000000000000000TR");
  });

  test("two or more steps: previous steps are meta-only; latest step is full", () => {
    const ctx: ThreadContext = {
      start: startTask("first message full: task content here"),
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "System." },
      steps: [
        {
          role: "planner",
          content: "PLANNER_SECRET_FULL_TEXT",
          meta: { plan: "short" },
          timestamp: 2,
        },
        {
          role: "coder",
          content: "last step full content",
          meta: { done: true },
          timestamp: 3,
        },
      ],
    };
    const text = buildAgentPrompt(ctx);
    expect(text).toContain("first message full: task content here");
    expect(text).toContain("## Previous Steps");
    expect(text).toContain("### Step 1: planner");
    expect(text).toContain('Summary: {"plan":"short"}');
    expect(text).not.toContain("PLANNER_SECRET_FULL_TEXT");
    expect(text).toContain("## Latest Step: coder");
    expect(text).toContain("last step full content");
    expect(text).toContain('Meta: {"done":true}');
    expect(text).toContain("## Tools");
    expect(text).toContain("uncaged-workflow thread 01TEST000000000000000000TR");
  });

  test("middle steps show meta summary only, not full content", () => {
    const ctx: ThreadContext = {
      start: startTask("start"),
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "c", systemPrompt: "S" },
      steps: [
        {
          role: "a",
          content: "HIDDEN_A",
          meta: { n: 1 },
          timestamp: 2,
        },
        {
          role: "b",
          content: "HIDDEN_B_MIDDLE",
          meta: { n: 2 },
          timestamp: 3,
        },
        {
          role: "c",
          content: "VISIBLE_LAST",
          meta: { n: 3 },
          timestamp: 4,
        },
      ],
    };
    const text = buildAgentPrompt(ctx);
    expect(text).not.toContain("HIDDEN_A");
    expect(text).not.toContain("HIDDEN_B_MIDDLE");
    expect(text).toContain('Summary: {"n":1}');
    expect(text).toContain('Summary: {"n":2}');
    expect(text).toContain("VISIBLE_LAST");
    expect(text).toContain("## Latest Step: c");
  });
});
