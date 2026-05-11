import { describe, expect, test } from "bun:test";
import { type AgentContext, START } from "@uncaged/workflow-runtime";

import { buildAgentPrompt } from "../src/index.js";

function startTask(content: string): AgentContext["start"] {
  return {
    role: START,
    content,
    meta: {},
    timestamp: 1,
  };
}

describe("buildAgentPrompt", () => {
  test("includes system prompt and full task; omits tools when there are no steps", async () => {
    const ctx: AgentContext = {
      start: startTask("fix the bug"),
      depth: 0,
      steps: [],
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: START, systemPrompt: "You are an agent." },
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain("You are an agent.");
    expect(text).toContain("## Task");
    expect(text).toContain("fix the bug");
    expect(text).not.toContain("## Tools");
  });

  test("single step shows hash and meta, and includes tools", async () => {
    const onlyHash = "01HASHSINGLESTEP0000000001";
    const ctx: AgentContext = {
      start: startTask("user task"),
      depth: 0,
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "Be helpful." },
      steps: [
        {
          role: "coder",
          contentHash: onlyHash,
          meta: { files: ["a.ts"] },
          refs: [onlyHash],
          timestamp: 2,
        },
      ],
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain("## Task");
    expect(text).toContain("user task");
    expect(text).toContain("## Step: coder");
    expect(text).toContain(`ContentHash: ${onlyHash}`);
    expect(text).toContain('Meta: {"files":["a.ts"]}');
    expect(text).toContain("## Tools");
    expect(text).toContain("uncaged-workflow thread 01TEST000000000000000000TR");
  });

  test("two or more steps: previous steps are meta-only; latest step includes hash", async () => {
    const plannerHash = "01HASHPLANNER0000000000001";
    const coderHash = "01HASHCODER0000000000000001";
    const ctx: AgentContext = {
      start: startTask("first message full: task content here"),
      depth: 0,
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "System." },
      steps: [
        {
          role: "planner",
          contentHash: plannerHash,
          meta: { plan: "short" },
          refs: [plannerHash],
          timestamp: 2,
        },
        {
          role: "coder",
          contentHash: coderHash,
          meta: { done: true },
          refs: [coderHash],
          timestamp: 3,
        },
      ],
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain("first message full: task content here");
    expect(text).toContain("## Previous Steps");
    expect(text).toContain("### Step 1: planner");
    expect(text).toContain('Summary: {"plan":"short"}');
    expect(text).toContain("## Latest Step: coder");
    expect(text).toContain(`ContentHash: ${coderHash}`);
    expect(text).toContain('Meta: {"done":true}');
    expect(text).toContain("## Tools");
    expect(text).toContain("uncaged-workflow thread 01TEST000000000000000000TR");
  });

  test("middle steps show meta summary only and latest shows hash", async () => {
    const ha = "01HASHA00000000000000000001";
    const hb = "01HASHB00000000000000000001";
    const hc = "01HASHC00000000000000000001";
    const ctx: AgentContext = {
      start: startTask("start"),
      depth: 0,
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "c", systemPrompt: "S" },
      steps: [
        {
          role: "a",
          contentHash: ha,
          meta: { n: 1 },
          refs: [ha],
          timestamp: 2,
        },
        {
          role: "b",
          contentHash: hb,
          meta: { n: 2 },
          refs: [hb],
          timestamp: 3,
        },
        {
          role: "c",
          contentHash: hc,
          meta: { n: 3 },
          refs: [hc],
          timestamp: 4,
        },
      ],
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain('Summary: {"n":1}');
    expect(text).toContain('Summary: {"n":2}');
    expect(text).toContain(`ContentHash: ${hc}`);
    expect(text).toContain("## Latest Step: c");
  });
});
