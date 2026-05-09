import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCasStore,
  putContentNodeWithRefs,
  putStartNode,
  putStateNode,
} from "@uncaged/workflow-cas";
import { buildThreadContext, END, START } from "../src/index.js";

describe("buildThreadContext", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wf-build-ctx-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("walks ancestor chain, resolves prompt, orders steps chronologically", async () => {
    const cas = createCasStore(join(dir, "cas"));
    const promptHash = await cas.put("hello-task");
    const bundleHash = "BHAAAAAAAAAAA";
    const startHash = await putStartNode(
      cas,
      { name: "demo", hash: bundleHash, maxRounds: 99, depth: 2 },
      promptHash,
    );

    const art = await cas.put("artifact-a");
    const chPlan = await putContentNodeWithRefs(cas, "plan body", [art]);
    const statePlan = await putStateNode(cas, {
      role: "planner",
      meta: { phase: 1 },
      start: startHash,
      content: chPlan,
      ancestors: [],
      compact: null,
      timestamp: 1000,
    });

    const chCode = await putContentNodeWithRefs(cas, "code body", []);
    const stateCode = await putStateNode(cas, {
      role: "coder",
      meta: { phase: 2 },
      start: startHash,
      content: chCode,
      ancestors: [statePlan],
      compact: null,
      timestamp: 2000,
    });

    const ctx = await buildThreadContext(stateCode, cas);
    expect(ctx.threadId).toBe("");
    expect(ctx.depth).toBe(2);
    expect(ctx.start.role).toBe(START);
    expect(ctx.start.content).toBe("hello-task");
    expect(ctx.start.meta.maxRounds).toBe(99);
    expect(ctx.steps.map((s) => s.role)).toEqual(["planner", "coder"]);
    expect(ctx.steps[0]?.refs).toEqual([art]);
    expect(ctx.steps[1]?.refs).toEqual([]);
    expect(ctx.steps[0]?.timestamp).toBe(1000);
    expect(ctx.steps[1]?.timestamp).toBe(2000);
  });

  test("StartNode head yields empty steps", async () => {
    const cas = createCasStore(join(dir, "cas"));
    const promptHash = await cas.put("only-prompt");
    const startHash = await putStartNode(
      cas,
      { name: "solo", hash: "BHBBBBBBBBBBB", maxRounds: 3, depth: 1 },
      promptHash,
    );

    const ctx = await buildThreadContext(startHash, cas);
    expect(ctx.steps).toEqual([]);
    expect(ctx.start.content).toBe("only-prompt");
    expect(ctx.depth).toBe(1);
    expect(ctx.start.meta.maxRounds).toBe(3);
  });

  test("omits __end__ states from steps", async () => {
    const cas = createCasStore(join(dir, "cas"));
    const promptHash = await cas.put("task");
    const bundleHash = "BHCCCCCCCCCCC";
    const startHash = await putStartNode(
      cas,
      { name: "demo", hash: bundleHash, maxRounds: 10, depth: 0 },
      promptHash,
    );

    const ch1 = await putContentNodeWithRefs(cas, "step-one", []);
    const state1 = await putStateNode(cas, {
      role: "worker",
      meta: { done: false },
      start: startHash,
      content: ch1,
      ancestors: [],
      compact: null,
      timestamp: 500,
    });

    const endContent = await putContentNodeWithRefs(cas, "finished", []);
    const endState = await putStateNode(cas, {
      role: END,
      meta: { returnCode: 0, summary: "finished" },
      start: startHash,
      content: endContent,
      ancestors: [state1],
      compact: null,
      timestamp: 600,
    });

    const ctx = await buildThreadContext(endState, cas);
    expect(ctx.steps.map((s) => s.role)).toEqual(["worker"]);
  });
});
