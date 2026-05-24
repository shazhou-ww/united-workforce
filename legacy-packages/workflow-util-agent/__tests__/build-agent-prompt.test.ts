import { describe, expect, test } from "bun:test";
import { type AgentContext, START } from "@uncaged/workflow-runtime";

import { buildAgentPrompt } from "../src/index.js";

function startTask(content: string, parentState: string | null = null): AgentContext["start"] {
  return {
    role: START,
    content,
    meta: {},
    timestamp: 1,
    parentState,
  };
}

describe("buildAgentPrompt", () => {
  test("includes system prompt and full task; omits tools when there are no steps", async () => {
    const ctx: AgentContext = {
      start: startTask("fix the bug"),
      depth: 0,
      bundleHash: "TESTHASH00001",
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

  test("single step shows meta and content, and includes tools", async () => {
    const onlyHash = "01HASHSINGLESTEP0000000001";
    const ctx: AgentContext = {
      start: startTask("user task"),
      depth: 0,
      bundleHash: "TESTHASH00001",
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "Be helpful." },
      steps: [
        {
          role: "coder",
          contentHash: onlyHash,
          content: "Here is my implementation of the feature.",
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
    expect(text).toContain('Meta: {"files":["a.ts"]}');
    expect(text).toContain("<output>");
    expect(text).toContain("Here is my implementation of the feature.");
    expect(text).toContain("</output>");
    expect(text).toContain("## Tools");
    expect(text).toContain("uncaged-workflow thread 01TEST000000000000000000TR");
  });

  test("single step with null content omits output tag", async () => {
    const onlyHash = "01HASHSINGLESTEP0000000001";
    const ctx: AgentContext = {
      start: startTask("user task"),
      depth: 0,
      bundleHash: "TESTHASH00001",
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "Be helpful." },
      steps: [
        {
          role: "coder",
          contentHash: onlyHash,
          content: null,
          meta: { files: ["a.ts"] },
          refs: [onlyHash],
          timestamp: 2,
        },
      ],
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).not.toContain("<output>");
    expect(text).toContain('Meta: {"files":["a.ts"]}');
  });

  test("two or more steps: previous steps are meta-only; latest step includes content", async () => {
    const plannerHash = "01HASHPLANNER0000000000001";
    const coderHash = "01HASHCODER0000000000000001";
    const ctx: AgentContext = {
      start: startTask("first message full: task content here"),
      depth: 0,
      bundleHash: "TESTHASH00001",
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "System." },
      steps: [
        {
          role: "planner",
          contentHash: plannerHash,
          content: null,
          meta: { plan: "short" },
          refs: [plannerHash],
          timestamp: 2,
        },
        {
          role: "coder",
          contentHash: coderHash,
          content: "I reviewed the code and found 4 lint issues:\n1. Missing semicolon on line 42\n2. Unused import on line 3",
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
    expect(text).toContain('Meta: {"done":true}');
    expect(text).toContain("<output>");
    expect(text).toContain("I reviewed the code and found 4 lint issues:");
    expect(text).toContain("</output>");
    expect(text).toContain("## Tools");
  });

  test("parentState null omits Parent Context section", async () => {
    const ctx: AgentContext = {
      start: startTask("top-level task"),
      depth: 0,
      bundleHash: "TESTHASH00001",
      steps: [],
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: START, systemPrompt: "You are an agent." },
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).not.toContain("## Parent Context");
  });

  test("parentState non-null includes Parent Context section with hash", async () => {
    const parentHash = "01PARENTSTATE0000000000001";
    const ctx: AgentContext = {
      start: startTask("child task", parentHash),
      depth: 1,
      bundleHash: "TESTHASH00001",
      steps: [],
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: START, systemPrompt: "You are an agent." },
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain("## Parent Context");
    expect(text).toContain(parentHash);
    expect(text).toContain(`uncaged-workflow cas get ${parentHash}`);
  });

  test("middle steps show meta summary only and latest shows content", async () => {
    const ha = "01HASHA00000000000000000001";
    const hb = "01HASHB00000000000000000001";
    const hc = "01HASHC00000000000000000001";
    const ctx: AgentContext = {
      start: startTask("start"),
      depth: 0,
      bundleHash: "TESTHASH00001",
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "c", systemPrompt: "S" },
      steps: [
        {
          role: "a",
          contentHash: ha,
          content: null,
          meta: { n: 1 },
          refs: [ha],
          timestamp: 2,
        },
        {
          role: "b",
          contentHash: hb,
          content: null,
          meta: { n: 2 },
          refs: [hb],
          timestamp: 3,
        },
        {
          role: "c",
          contentHash: hc,
          content: "Final output from role c",
          meta: { n: 3 },
          refs: [hc],
          timestamp: 4,
        },
      ],
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain('Summary: {"n":1}');
    expect(text).toContain('Summary: {"n":2}');
    expect(text).toContain("## Latest Step: c");
    expect(text).toContain("<output>");
    expect(text).toContain("Final output from role c");
    expect(text).toContain("</output>");
  });

  test("content is truncated when exceeding quota", async () => {
    const longContent = "x".repeat(20_000);
    const hash = "01HASHLONG000000000000000001";
    const ctx: AgentContext = {
      start: startTask("task"),
      depth: 0,
      bundleHash: "TESTHASH00001",
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "r", systemPrompt: "S" },
      steps: [
        {
          role: "r",
          contentHash: hash,
          content: longContent,
          meta: {},
          refs: [],
          timestamp: 2,
        },
      ],
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain("<output>");
    expect(text).toContain("... (truncated)");
    expect(text.length).toBeLessThan(20_000);
  });
});
