import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasStore, putContentMerkleNode, START, type ThreadContext } from "@uncaged/workflow";

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
  let casRoot: string;

  beforeEach(async () => {
    casRoot = await mkdtemp(join(tmpdir(), "wf-build-prompt-cas-"));
  });

  afterEach(async () => {
    await rm(casRoot, { recursive: true, force: true });
  });

  test("includes system prompt and full task; omits tools when there are no steps", async () => {
    const cas = createCasStore(casRoot);
    const ctx: ThreadContext = {
      start: startTask("fix the bug"),
      depth: 0,
      steps: [],
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: START, systemPrompt: "You are an agent." },
      cas,
    };
    const text = await buildAgentPrompt(ctx);
    expect(text).toContain("You are an agent.");
    expect(text).toContain("## Task");
    expect(text).toContain("fix the bug");
    expect(text).not.toContain("## Tools");
  });

  test("single step shows full content and meta, and includes tools", async () => {
    const cas = createCasStore(casRoot);
    const onlyHash = await putContentMerkleNode(cas, "only step full body");
    const ctx: ThreadContext = {
      start: startTask("user task"),
      depth: 0,
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "Be helpful." },
      cas,
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
    expect(text).toContain("only step full body");
    expect(text).toContain('Meta: {"files":["a.ts"]}');
    expect(text).toContain("## Tools");
    expect(text).toContain("uncaged-workflow thread 01TEST000000000000000000TR");
  });

  test("two or more steps: previous steps are meta-only; latest step is full", async () => {
    const cas = createCasStore(casRoot);
    const plannerHash = await putContentMerkleNode(cas, "PLANNER_SECRET_FULL_TEXT");
    const coderHash = await putContentMerkleNode(cas, "last step full content");
    const ctx: ThreadContext = {
      start: startTask("first message full: task content here"),
      depth: 0,
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "coder", systemPrompt: "System." },
      cas,
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
    expect(text).not.toContain("PLANNER_SECRET_FULL_TEXT");
    expect(text).toContain("## Latest Step: coder");
    expect(text).toContain("last step full content");
    expect(text).toContain('Meta: {"done":true}');
    expect(text).toContain("## Tools");
    expect(text).toContain("uncaged-workflow thread 01TEST000000000000000000TR");
  });

  test("middle steps show meta summary only, not full content", async () => {
    const cas = createCasStore(casRoot);
    const ha = await putContentMerkleNode(cas, "HIDDEN_A");
    const hb = await putContentMerkleNode(cas, "HIDDEN_B_MIDDLE");
    const hc = await putContentMerkleNode(cas, "VISIBLE_LAST");
    const ctx: ThreadContext = {
      start: startTask("start"),
      depth: 0,
      threadId: "01TEST000000000000000000TR",
      currentRole: { name: "c", systemPrompt: "S" },
      cas,
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
    expect(text).not.toContain("HIDDEN_A");
    expect(text).not.toContain("HIDDEN_B_MIDDLE");
    expect(text).toContain('Summary: {"n":1}');
    expect(text).toContain('Summary: {"n":2}');
    expect(text).toContain("VISIBLE_LAST");
    expect(text).toContain("## Latest Step: c");
  });
});
