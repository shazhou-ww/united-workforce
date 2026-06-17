import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, StepStartPayload, TurnNodePayload } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { turnsOfStep, walkTurnChain, writeStepStart, writeTurnNode } from "../store.js";
import { makeUwfStore } from "./thread-test-helpers.js";

let tmpDir: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "uwf-turn-chain-test-"));
});

afterEach(async () => {
  if (savedOcasHome === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = savedOcasHome;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("writeStepStart", () => {
  test("creates step-start nodes linked via prev", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    // Step 0: first step (prev = null)
    const step0Payload: StepStartPayload = {
      role: "planner",
      edgePrompt: "Analyze the issue",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    };
    const ss0 = writeStepStart(uwf, step0Payload);

    // Step 1: linked to step 0
    const step1Payload: StepStartPayload = {
      role: "developer",
      edgePrompt: "Implement the fix",
      stepIndex: 1,
      prev: ss0,
      start: startRef,
      startedAtMs: 2000,
      cwd: "/repo",
    };
    const ss1 = writeStepStart(uwf, step1Payload);

    // Step 2: linked to step 1
    const step2Payload: StepStartPayload = {
      role: "reviewer",
      edgePrompt: "Review the changes",
      stepIndex: 2,
      prev: ss1,
      start: startRef,
      startedAtMs: 3000,
      cwd: "/repo",
    };
    const ss2 = writeStepStart(uwf, step2Payload);

    // Verify hashes are distinct
    expect(ss0).not.toBe(ss1);
    expect(ss1).not.toBe(ss2);
    expect(ss0).not.toBe(ss2);

    // Verify each is 13-char Crockford Base32
    expect(ss0.length).toBe(13);
    expect(ss1.length).toBe(13);
    expect(ss2.length).toBe(13);

    // Verify nodes can be retrieved and contain exact payloads
    const node0 = uwf.store.cas.get(ss0);
    const node1 = uwf.store.cas.get(ss1);
    const node2 = uwf.store.cas.get(ss2);

    expect(node0).not.toBeNull();
    expect(node1).not.toBeNull();
    expect(node2).not.toBeNull();

    const payload0 = node0?.payload as StepStartPayload;
    const payload1 = node1?.payload as StepStartPayload;
    const payload2 = node2?.payload as StepStartPayload;

    expect(payload0.role).toBe("planner");
    expect(payload0.stepIndex).toBe(0);
    expect(payload0.prev).toBeNull();

    expect(payload1.role).toBe("developer");
    expect(payload1.stepIndex).toBe(1);
    expect(payload1.prev).toBe(ss0);

    expect(payload2.role).toBe("reviewer");
    expect(payload2.stepIndex).toBe(2);
    expect(payload2.prev).toBe(ss1);

    // Verify walking the chain from SS2 via prev yields [SS2, SS1, SS0]
    const chain: CasRef[] = [];
    let currentHash: CasRef | null = ss2;
    while (currentHash !== null) {
      chain.push(currentHash);
      const node = uwf.store.cas.get(currentHash);
      if (node === null) break;
      const payload = node.payload as StepStartPayload;
      currentHash = payload.prev;
    }
    expect(chain).toEqual([ss2, ss1, ss0]);

    // Verify stepIndex values in chain order
    expect((uwf.store.cas.get(chain[0])?.payload as StepStartPayload).stepIndex).toBe(2);
    expect((uwf.store.cas.get(chain[1])?.payload as StepStartPayload).stepIndex).toBe(1);
    expect((uwf.store.cas.get(chain[2])?.payload as StepStartPayload).stepIndex).toBe(0);
  });
});

describe("walkTurnChain", () => {
  test("traverses turns via prev pointers in chronological order", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    // Create step-start nodes
    const ss0 = writeStepStart(uwf, {
      role: "planner",
      edgePrompt: "Plan",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    });
    const ss1 = writeStepStart(uwf, {
      role: "developer",
      edgePrompt: "Develop",
      stepIndex: 1,
      prev: ss0,
      start: startRef,
      startedAtMs: 2000,
      cwd: "/repo",
    });
    const ss2 = writeStepStart(uwf, {
      role: "reviewer",
      edgePrompt: "Review",
      stepIndex: 2,
      prev: ss1,
      start: startRef,
      startedAtMs: 3000,
      cwd: "/repo",
    });

    // Create 6 turns with prev links
    const t0 = writeTurnNode(uwf, {
      role: "assistant",
      content: "Step 1 analysis",
      prev: null,
      owner: ss0,
    });
    const t1 = writeTurnNode(uwf, {
      role: "assistant",
      content: "Step 1 continued",
      prev: t0,
      owner: ss0,
    });
    const t2 = writeTurnNode(uwf, {
      role: "assistant",
      content: "Step 2 start",
      prev: t1,
      owner: ss1,
    });
    const t3 = writeTurnNode(uwf, {
      role: "assistant",
      content: "Step 2 continued",
      prev: t2,
      owner: ss1,
    });
    const t4 = writeTurnNode(uwf, {
      role: "assistant",
      content: "Step 3 start",
      prev: t3,
      owner: ss2,
    });
    const t5 = writeTurnNode(uwf, {
      role: "assistant",
      content: "Step 3 final",
      prev: t4,
      owner: ss2,
    });

    // Walk from head (t5)
    const result = walkTurnChain(uwf, t5);

    // Verify returns 6 hashes in chronological order (oldest first)
    expect(result).toHaveLength(6);
    expect(result).toEqual([t0, t1, t2, t3, t4, t5]);

    // Verify content matches
    const contents = result.map((h) => {
      const node = uwf.store.cas.get(h);
      return (node?.payload as TurnNodePayload).content;
    });
    expect(contents).toEqual([
      "Step 1 analysis",
      "Step 1 continued",
      "Step 2 start",
      "Step 2 continued",
      "Step 3 start",
      "Step 3 final",
    ]);
  });

  test("returns single-element array for turn with null prev", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    const ss0 = writeStepStart(uwf, {
      role: "planner",
      edgePrompt: "Plan",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    });

    const t0 = writeTurnNode(uwf, {
      role: "assistant",
      content: "Single turn",
      prev: null,
      owner: ss0,
    });

    const result = walkTurnChain(uwf, t0);
    expect(result).toEqual([t0]);
  });
});

describe("turnsOfStep", () => {
  test("returns only turns belonging to a specific step-start", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    // Create step-start nodes
    const ss0 = writeStepStart(uwf, {
      role: "planner",
      edgePrompt: "Plan",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    });
    const ss1 = writeStepStart(uwf, {
      role: "developer",
      edgePrompt: "Develop",
      stepIndex: 1,
      prev: ss0,
      start: startRef,
      startedAtMs: 2000,
      cwd: "/repo",
    });
    const ss2 = writeStepStart(uwf, {
      role: "reviewer",
      edgePrompt: "Review",
      stepIndex: 2,
      prev: ss1,
      start: startRef,
      startedAtMs: 3000,
      cwd: "/repo",
    });

    // Create 6 turns with different owners (2 per step)
    const t0 = writeTurnNode(uwf, { role: "assistant", content: "T0", prev: null, owner: ss0 });
    const t1 = writeTurnNode(uwf, { role: "assistant", content: "T1", prev: t0, owner: ss0 });
    const t2 = writeTurnNode(uwf, { role: "assistant", content: "T2", prev: t1, owner: ss1 });
    const t3 = writeTurnNode(uwf, { role: "assistant", content: "T3", prev: t2, owner: ss1 });
    const t4 = writeTurnNode(uwf, { role: "assistant", content: "T4", prev: t3, owner: ss2 });
    const t5 = writeTurnNode(uwf, { role: "assistant", content: "T5", prev: t4, owner: ss2 });

    // Filter for SS1's turns
    const result = turnsOfStep(uwf, t5, ss1);

    // Should return exactly T2 and T3 in chronological order
    expect(result).toHaveLength(2);
    expect(result).toEqual([t2, t3]);
  });

  test("returns empty array when no turns match the step", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    const ss0 = writeStepStart(uwf, {
      role: "planner",
      edgePrompt: "Plan",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    });
    const ssOther = writeStepStart(uwf, {
      role: "other",
      edgePrompt: "Other",
      stepIndex: 1,
      prev: ss0,
      start: startRef,
      startedAtMs: 2000,
      cwd: "/repo",
    });

    const t0 = writeTurnNode(uwf, { role: "assistant", content: "T0", prev: null, owner: ss0 });
    const t1 = writeTurnNode(uwf, { role: "assistant", content: "T1", prev: t0, owner: ss0 });

    // Filter for ssOther's turns (should be empty)
    const result = turnsOfStep(uwf, t1, ssOther);
    expect(result).toEqual([]);
  });
});

describe("legacy turn compatibility", () => {
  test("legacy turns without prev/owner read as null", async () => {
    const uwf = await makeUwfStore(tmpDir);

    // Simulate legacy turn by writing with null prev/owner
    const legacyTurn = writeTurnNode(uwf, {
      role: "assistant",
      content: "Some output",
      prev: null,
      owner: null,
    });

    // Reading should succeed
    const node = uwf.store.cas.get(legacyTurn);
    expect(node).not.toBeNull();

    const payload = node?.payload as TurnNodePayload;
    expect(payload.prev).toBeNull();
    expect(payload.owner).toBeNull();
    expect(payload.role).toBe("assistant");
    expect(payload.content).toBe("Some output");
  });

  test("walkTurnChain handles legacy turn with null prev", async () => {
    const uwf = await makeUwfStore(tmpDir);

    const legacyTurn = writeTurnNode(uwf, {
      role: "assistant",
      content: "Legacy content",
      prev: null,
      owner: null,
    });

    // Should return single-element array
    const result = walkTurnChain(uwf, legacyTurn);
    expect(result).toEqual([legacyTurn]);
  });

  test("turnsOfStep returns empty for legacy turn with null owner", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    const anyStepHash = writeStepStart(uwf, {
      role: "planner",
      edgePrompt: "Plan",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    });

    const legacyTurn = writeTurnNode(uwf, {
      role: "assistant",
      content: "Legacy content",
      prev: null,
      owner: null,
    });

    // Legacy turn's owner is null, won't match any step
    const result = turnsOfStep(uwf, legacyTurn, anyStepHash);
    expect(result).toEqual([]);
  });
});
