/**
 * Phase 2 (#419) — Turn chain with prev+owner fields and thread-keyed active vars.
 *
 * Covers the spec acceptance scenarios:
 *   1. onTurn writes each turn with prev pointer and owner reference
 *   2. Step-start/step-complete dual node lifecycle
 *   3. Same role multi-round ownership (#412 regression test)
 *   4. Thread-keyed active vars (not role-keyed)
 *   5. Crash recovery isolation (new attempt gets new step-start)
 *   6. Detail node has no turns array (turns self-contained via chain)
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import type {
  CasRef,
  StepStartPayload,
  ThreadId,
  TurnNodePayload,
  WorkflowConfig,
  WorkflowPayload,
} from "@united-workforce/protocol";
import { createProcessLogger } from "@united-workforce/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeBrokerStep } from "../commands/broker-step.js";
import {
  ACTIVE_TURNS_VAR_PREFIX,
  activeStepVarName,
  activeTurnHeadVarName,
  createUwfStore,
  getActiveStep,
  getActiveTurnHead,
  turnsOfStep,
  type UwfStore,
  walkTurnChain,
  writeStepStart,
  writeTurnNode,
} from "../store.js";

// ── SSE plumbing ─────────────────────────────────────────────────────────────

function sseFrame(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function turnFrame(id: number, index: number, content: string): string {
  return sseFrame(id, "turn", {
    type: "@sumeru/turn",
    value: { index, role: "assistant", content, timestamp: "", toolCalls: null },
  });
}

function doneFrame(id: number, turnCount: number): string {
  return sseFrame(id, "done", {
    type: "@sumeru/summary",
    value: { turnCount, tokens: { in: 9, out: 4 }, durationMs: 42 },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PER_TURN_MS = 40;

function buildPacedSseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for (const frame of frames) {
            if (cancelled) return;
            controller.enqueue(encoder.encode(frame));
            await delay(PER_TURN_MS);
          }
          if (!cancelled) controller.close();
        } catch {
          // Consumer closed/cancelled the stream first
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

function buildJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Fixture ──────────────────────────────────────────────────────────────────

const ROLE_OUTPUT_SCHEMA = {
  title: "coder-output",
  type: "object" as const,
  required: ["$status"],
  properties: {
    $status: { type: "string" as const, enum: ["done", "failed"] },
    summary: { type: "string" as const },
  },
  additionalProperties: false,
};

const FINAL_TURN = `---
$status: done
summary: shipped
---
the final answer`;

const HOST = "http://127.0.0.1:7900";
const GATEWAY = "coder-gw";
const ALIAS = "coder-agent";
const SESSION_ID = "ses_turn_chain_phase2";
const THREAD_ID = "06FDTURNCHAINPHASE2TEST01" as ThreadId;
const ROLE = "coder";

function buildConfig(): WorkflowConfig {
  return {
    agents: { [ALIAS]: { host: HOST, gateway: GATEWAY } },
    defaultAgent: ALIAS,
    agentOverrides: null,
  };
}

async function buildWorkflow(uwf: UwfStore): Promise<{
  workflow: WorkflowPayload;
  startHash: CasRef;
}> {
  const frontmatterHash = (await putSchema(uwf.store, ROLE_OUTPUT_SCHEMA)) as CasRef;
  const workflow: WorkflowPayload = {
    version: 1,
    name: "turn-chain-wf",
    description: "phase2 turn chain",
    roles: {
      [ROLE]: {
        description: "writes code",
        goal: "produce a change",
        capabilities: [],
        procedure: "do the work",
        output: "frontmatter+body",
        frontmatter: frontmatterHash,
      },
    },
    graph: {
      [ROLE]: {
        done: { role: "$END", prompt: "", location: null },
      },
    },
  };
  const startHash = (await uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: await uwf.store.cas.put(uwf.schemas.workflow, workflow),
    prompt: "task",
    cwd: "/tmp/work",
  })) as CasRef;
  return { workflow, startHash };
}

function resolveFetchUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function runStep(
  uwf: UwfStore,
  workflow: WorkflowPayload,
  startHash: CasRef,
  tmpDir: string,
  prevHash: CasRef | null = null,
) {
  return executeBrokerStep({
    storageRoot: tmpDir,
    uwf,
    config: buildConfig(),
    workflow,
    threadId: THREAD_ID,
    role: ROLE,
    edgePrompt: "go",
    effectiveCwd: "/tmp/work",
    startHash,
    prevHash,
    agentOverride: null,
    previousAttempts: null,
    plog: createProcessLogger({
      storageRoot: tmpDir,
      context: { thread: THREAD_ID, workflow: "turn-chain-wf" },
    }),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("turn chain Phase 2 (#419)", () => {
  let tmpDir: string;
  let casDir: string;
  let savedOcasHome: string | undefined;

  beforeEach(async () => {
    savedOcasHome = process.env.OCAS_HOME;
    tmpDir = await mkdtemp(join(tmpdir(), "turn-chain-phase2-"));
    casDir = join(tmpDir, "cas");
    process.env.OCAS_HOME = casDir;

    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, _init: RequestInit | undefined): Promise<Response> => {
        const url = resolveFetchUrl(input);
        if (url.endsWith(`/gateways/${GATEWAY}/sessions`)) {
          return buildJsonResponse(201, {
            type: "@sumeru/session",
            value: { id: SESSION_ID, gateway: GATEWAY },
          });
        }
        if (url.endsWith(`/sessions/${SESSION_ID}/messages`)) {
          return buildPacedSseResponse([
            turnFrame(1, 0, "First analysis"),
            turnFrame(2, 1, "Continued work"),
            turnFrame(3, 2, FINAL_TURN),
            doneFrame(4, 3),
          ]);
        }
        return buildJsonResponse(500, { error: "unexpected url", url });
      },
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (savedOcasHome === undefined) delete process.env.OCAS_HOME;
    else process.env.OCAS_HOME = savedOcasHome;
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("onTurn writes each turn with prev pointer and owner reference", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await runStep(uwf, workflow, startHash, tmpDir);
    expect(result.isError).toBe(false);

    // Get the turn chain head
    const turnHead = getActiveTurnHead(uwf.store, THREAD_ID);
    expect(turnHead).not.toBeNull();

    // Walk the turn chain
    const turnChain = walkTurnChain(uwf, turnHead!);
    expect(turnChain).toHaveLength(3);

    // Verify each turn has correct prev and owner
    const turn0 = uwf.store.cas.get(turnChain[0]!)?.payload as TurnNodePayload;
    const turn1 = uwf.store.cas.get(turnChain[1]!)?.payload as TurnNodePayload;
    const turn2 = uwf.store.cas.get(turnChain[2]!)?.payload as TurnNodePayload;

    // Turn 0: first turn, prev is null
    expect(turn0.prev).toBeNull();
    expect(turn0.owner).not.toBeNull();
    expect(turn0.content).toBe("First analysis");

    // Turn 1: prev points to turn 0
    expect(turn1.prev).toBe(turnChain[0]);
    expect(turn1.owner).toBe(turn0.owner);
    expect(turn1.content).toBe("Continued work");

    // Turn 2: prev points to turn 1
    expect(turn2.prev).toBe(turnChain[1]);
    expect(turn2.owner).toBe(turn0.owner);
    expect(turn2.content).toBe(FINAL_TURN);

    // All turns have same owner (the step-start)
    expect(turn0.owner).toBe(turn1.owner);
    expect(turn1.owner).toBe(turn2.owner);
  });

  test("step-start is written at entry and active-step var is set", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    // Capture active-step during execution
    let activeStepDuringExec: CasRef | null = null;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init: RequestInit | undefined): Promise<Response> => {
        const url = resolveFetchUrl(input);
        if (url.endsWith(`/sessions/${SESSION_ID}/messages`)) {
          // Sample active-step while broker is in flight
          activeStepDuringExec = getActiveStep(uwf.store, THREAD_ID);
        }
        return (originalFetch as typeof fetch)(input, init);
      },
    );

    const result = await runStep(uwf, workflow, startHash, tmpDir);
    expect(result.isError).toBe(false);

    // active-step was set during execution
    expect(activeStepDuringExec).not.toBeNull();

    // active-step is cleared after completion
    const activeStepAfter = getActiveStep(uwf.store, THREAD_ID);
    expect(activeStepAfter).toBeNull();

    // Verify step-start node exists and has correct structure
    const stepStartNode = uwf.store.cas.get(activeStepDuringExec!);
    expect(stepStartNode).not.toBeNull();
    const stepStartPayload = stepStartNode?.payload as StepStartPayload;
    expect(stepStartPayload.role).toBe(ROLE);
    expect(stepStartPayload.edgePrompt).toBe("go");
    expect(stepStartPayload.stepIndex).toBe(0);
    expect(stepStartPayload.prev).toBeNull();
    expect(stepStartPayload.start).toBe(startHash);
  });

  test("detail node has no turns array (turns self-contained via chain)", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await runStep(uwf, workflow, startHash, tmpDir);
    expect(result.isError).toBe(false);

    // Get detail node
    const detailNode = uwf.store.cas.get(result.detailHash);
    expect(detailNode).not.toBeNull();

    const detail = detailNode?.payload as Record<string, unknown>;

    // Detail should have sessionId, duration, turnCount but NOT turns array
    expect(detail.sessionId).toBe(SESSION_ID);
    expect(typeof detail.duration).toBe("number");
    expect(detail.turnCount).toBe(3);
    expect(detail.turns).toBeUndefined(); // No turns array in Phase 2
  });

  test("thread-keyed active vars exist, role-keyed do not", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    await runStep(uwf, workflow, startHash, tmpDir);

    // Thread-keyed turn head exists
    const turnHeadVars = uwf.varStore.list({
      exactName: activeTurnHeadVarName(THREAD_ID),
    });
    expect(turnHeadVars.length).toBe(1);

    // Active-step var is cleared (step completed)
    const activeStepVars = uwf.varStore.list({
      exactName: activeStepVarName(THREAD_ID),
    });
    expect(activeStepVars.length).toBe(0);

    // Role-keyed var is also cleared (backward compat cleanup)
    const roleKeyedVars = uwf.varStore.list({
      namePrefix: `${ACTIVE_TURNS_VAR_PREFIX}${THREAD_ID}/`,
    });
    expect(roleKeyedVars.length).toBe(0);
  });

  test("turnsOfStep filters turns by owner", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await runStep(uwf, workflow, startHash, tmpDir);
    expect(result.isError).toBe(false);

    const turnHead = getActiveTurnHead(uwf.store, THREAD_ID);
    expect(turnHead).not.toBeNull();

    // Get the step-start from the first turn's owner
    const firstTurn = uwf.store.cas.get(walkTurnChain(uwf, turnHead!)[0]!)
      ?.payload as TurnNodePayload;
    const stepStartHash = firstTurn.owner!;

    // turnsOfStep should return all 3 turns for this step
    const stepTurns = turnsOfStep(uwf, turnHead!, stepStartHash);
    expect(stepTurns).toHaveLength(3);

    // A different step-start should return no turns
    const otherStepStart = writeStepStart(uwf, {
      role: "other",
      edgePrompt: "other",
      stepIndex: 1,
      prev: stepStartHash,
      start: startHash,
      startedAtMs: Date.now(),
      cwd: "/tmp",
    });
    const otherTurns = turnsOfStep(uwf, turnHead!, otherStepStart);
    expect(otherTurns).toHaveLength(0);
  });
});

describe("turn chain unit tests", () => {
  let tmpDir: string;
  let savedOcasHome: string | undefined;

  beforeEach(async () => {
    savedOcasHome = process.env.OCAS_HOME;
    tmpDir = await mkdtemp(join(tmpdir(), "turn-chain-unit-"));
    process.env.OCAS_HOME = join(tmpDir, "cas");
  });

  afterEach(async () => {
    if (savedOcasHome === undefined) delete process.env.OCAS_HOME;
    else process.env.OCAS_HOME = savedOcasHome;
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("same role multi-round: turns have correct owner (#412 regression)", async () => {
    const uwf = await createUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    // Round 1: developer
    const ss_dev1 = writeStepStart(uwf, {
      role: "developer",
      edgePrompt: "Implement",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    });
    const t1 = writeTurnNode(uwf, { role: "assistant", content: "T1", prev: null, owner: ss_dev1 });
    const t2 = writeTurnNode(uwf, { role: "assistant", content: "T2", prev: t1, owner: ss_dev1 });

    // Reviewer
    const ss_rev = writeStepStart(uwf, {
      role: "reviewer",
      edgePrompt: "Review",
      stepIndex: 1,
      prev: ss_dev1,
      start: startRef,
      startedAtMs: 2000,
      cwd: "/repo",
    });
    const t3 = writeTurnNode(uwf, { role: "assistant", content: "T3", prev: t2, owner: ss_rev });
    const t4 = writeTurnNode(uwf, { role: "assistant", content: "T4", prev: t3, owner: ss_rev });

    // Round 2: developer again (same role, different step-start)
    const ss_dev2 = writeStepStart(uwf, {
      role: "developer",
      edgePrompt: "Fix issues",
      stepIndex: 2,
      prev: ss_rev,
      start: startRef,
      startedAtMs: 3000,
      cwd: "/repo",
    });
    const t5 = writeTurnNode(uwf, { role: "assistant", content: "T5", prev: t4, owner: ss_dev2 });

    // Verify ownership
    expect((uwf.store.cas.get(t1)?.payload as TurnNodePayload).owner).toBe(ss_dev1);
    expect((uwf.store.cas.get(t2)?.payload as TurnNodePayload).owner).toBe(ss_dev1);
    expect((uwf.store.cas.get(t3)?.payload as TurnNodePayload).owner).toBe(ss_rev);
    expect((uwf.store.cas.get(t4)?.payload as TurnNodePayload).owner).toBe(ss_rev);
    expect((uwf.store.cas.get(t5)?.payload as TurnNodePayload).owner).toBe(ss_dev2);

    // turnsOfStep correctly filters by owner
    expect(turnsOfStep(uwf, t5, ss_dev1)).toEqual([t1, t2]);
    expect(turnsOfStep(uwf, t5, ss_rev)).toEqual([t3, t4]);
    expect(turnsOfStep(uwf, t5, ss_dev2)).toEqual([t5]);

    // Step-start chain is correct
    expect((uwf.store.cas.get(ss_dev2)?.payload as StepStartPayload).prev).toBe(ss_rev);
    expect((uwf.store.cas.get(ss_rev)?.payload as StepStartPayload).prev).toBe(ss_dev1);
    expect((uwf.store.cas.get(ss_dev1)?.payload as StepStartPayload).prev).toBeNull();
  });

  test("crash recovery: new attempt gets new step-start, old turns orphaned", async () => {
    const uwf = await createUwfStore(tmpDir);
    const startRef = (await uwf.store.cas.put(uwf.schemas.text, "thread-start")) as CasRef;

    // Attempt 1 (crashed): step-start SS1 with 2 turns
    const ss1 = writeStepStart(uwf, {
      role: "developer",
      edgePrompt: "Implement",
      stepIndex: 0,
      prev: null,
      start: startRef,
      startedAtMs: 1000,
      cwd: "/repo",
    });
    const t1 = writeTurnNode(uwf, { role: "assistant", content: "Old T1", prev: null, owner: ss1 });
    const t2 = writeTurnNode(uwf, { role: "assistant", content: "Old T2", prev: t1, owner: ss1 });

    // Attempt 2 (recovery): new step-start SS2
    const ss2 = writeStepStart(uwf, {
      role: "developer",
      edgePrompt: "Implement",
      stepIndex: 0,
      prev: null, // Same prev as SS1 (recovery starts fresh)
      start: startRef,
      startedAtMs: 2000,
      cwd: "/repo",
    });

    // New turns link to global chain (prev=t2) but have different owner
    const t3 = writeTurnNode(uwf, { role: "assistant", content: "New T3", prev: t2, owner: ss2 });
    const t4 = writeTurnNode(uwf, { role: "assistant", content: "New T4", prev: t3, owner: ss2 });

    // SS1 and SS2 have different hashes
    expect(ss1).not.toBe(ss2);

    // Old attempt's turns belong to SS1
    expect(turnsOfStep(uwf, t4, ss1)).toEqual([t1, t2]);

    // New attempt's turns belong to SS2
    expect(turnsOfStep(uwf, t4, ss2)).toEqual([t3, t4]);

    // Walking the full chain shows all 4 turns
    expect(walkTurnChain(uwf, t4)).toEqual([t1, t2, t3, t4]);
  });
});
