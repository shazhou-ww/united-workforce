/**
 * Phase 2 (#398 + #419) — realtime turn persistence in `executeBrokerStep`.
 *
 * Updated for Phase 2 (#419):
 *   - Turns are now written with `prev`+`owner` chain instead of accumulating in
 *     `@uwf/active-turns/<tid>/<role>` array var
 *   - Detail node no longer contains `turns` array — use `turnsOfStep()` to retrieve
 *   - Thread-keyed active vars (`@uwf/active-step/<tid>`, `@uwf/active-turn-head/<tid>`)
 *
 * Covers the acceptance steps:
 *   Step 1 — broker-step's `onTurn` writes each turn with `prev`+`owner` chain;
 *            the turn chain grows 1→2→3.
 *   Step 2 — on completion, detail has `turnCount===3` (no `turns` array);
 *            turns are accessible via `turnsOfStep()`.
 *   Step 3 — a crash-rerun is a fresh attempt: new step-start isolates old turns
 *            via different `owner` reference.
 *   Step 4 — cross-process visibility: thread-keyed turn head var is observable.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema, type Store } from "@ocas/core";
import { createFsStore, createSqliteVarStore } from "@ocas/fs";
import type {
  CasRef,
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
  activeTurnsVarName,
  appendActiveTurn,
  createUwfStore,
  getActiveTurnHead,
  readActiveTurns,
  turnsOfStep,
  type UwfStore,
  walkTurnChain,
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

/** How long each assistant turn is held back, so readers can sample between them. */
const PER_TURN_MS = 40;

/**
 * Build a paced SSE Response: each frame is enqueued `PER_TURN_MS` after the
 * previous, so the broker's reader loop fires `onTurn` one turn at a time and a
 * concurrent reader can observe the active var growing. Robust to consumer
 * cancellation (the broker cancels its reader in a `finally`), so a late
 * `enqueue`/`close` after cancel is swallowed rather than surfacing as an
 * unhandled rejection.
 */
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
          // Consumer closed/cancelled the stream first — nothing to do.
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

// ── Fixture: role schema + workflow ──────────────────────────────────────────

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

/**
 * The final assistant turn carries valid frontmatter so extraction succeeds on
 * the primary send (no retries → exactly one onTurn per emitted turn). Its
 * stored content is this whole block (byte-for-byte), which is what the
 * solidified `detail.turns[last]` holds.
 */
const FINAL_TURN = `---
$status: done
summary: shipped
---
the final answer`;

const HOST = "http://127.0.0.1:7900";
const GATEWAY = "coder-gw";
const ALIAS = "coder-agent";
const SESSION_ID = "ses_active_turns";
const THREAD_ID = "06FCACTIVETURNSPHASE2A001" as ThreadId;
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
    name: "active-turns-wf",
    description: "phase2 realtime turns",
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

/** Drive one broker step end-to-end with the configured fixture. */
function runStep(uwf: UwfStore, workflow: WorkflowPayload, startHash: CasRef, tmpDir: string) {
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
    prevHash: null,
    agentOverride: null,
    previousAttempts: null,
    plog: createProcessLogger({
      storageRoot: tmpDir,
      context: { thread: THREAD_ID, workflow: "active-turns-wf" },
    }),
  });
}

/** Resolve the `content` of a turn node hash, or `null`. */
function turnContent(store: Store, hash: CasRef): string | null {
  const node = store.cas.get(hash);
  if (node === null) return null;
  const payload = node.payload as Record<string, unknown>;
  return typeof payload.content === "string" ? payload.content : null;
}

/**
 * An *independent* reader of the shared on-disk store — a fresh CAS (its own
 * hash-set scan) and a fresh SQLite connection — simulating "process B" reading
 * the WAL-committed active var while "process A" runs the step.
 */
function openReader(casDir: string): { store: Store; close: () => void } {
  const cas = createFsStore(casDir);
  const { var: varStore, tag, close } = createSqliteVarStore(join(casDir, "vars"), cas);
  return { store: { cas, var: varStore, tag }, close };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("active-turns realtime persistence (#398)", () => {
  let tmpDir: string;
  let casDir: string;
  let savedOcasHome: string | undefined;
  let messageBodies: string[];

  beforeEach(async () => {
    savedOcasHome = process.env.OCAS_HOME;
    tmpDir = await mkdtemp(join(tmpdir(), "active-turns-"));
    casDir = join(tmpDir, "cas");
    process.env.OCAS_HOME = casDir;
    messageBodies = [];

    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init: RequestInit | undefined): Promise<Response> => {
        const url = resolveFetchUrl(input);
        if (url.endsWith(`/gateways/${GATEWAY}/sessions`)) {
          return buildJsonResponse(201, {
            type: "@sumeru/session",
            value: { id: SESSION_ID, gateway: GATEWAY },
          });
        }
        if (url.endsWith(`/sessions/${SESSION_ID}/messages`)) {
          messageBodies.push(typeof init?.body === "string" ? init.body : "");
          return buildPacedSseResponse([
            turnFrame(1, 0, "t1"),
            turnFrame(2, 1, "t2"),
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

  // Step 1 — the turn chain grows 1 → 2 → 3 as onTurn fires (Phase 2: via turn chain, not role-keyed var).
  test("turn chain grows 1 -> 2 -> 3 via prev+owner chain as turns stream", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const p = runStep(uwf, workflow, startHash, tmpDir);

    // Sample the turn chain head while the step is in flight.
    const chainLengths: number[] = [];
    let finished = false;
    void p.finally(() => {
      finished = true;
    });
    while (!finished) {
      const head = getActiveTurnHead(uwf.store, THREAD_ID);
      const len = head !== null ? walkTurnChain(uwf, head).length : 0;
      chainLengths.push(len);
      await delay(PER_TURN_MS / 4);
    }
    const result = await p;

    // Monotonic growth: first occurrences of 1, 2, 3 appear in order.
    const firstIndexOf = (n: number) => chainLengths.indexOf(n);
    expect(firstIndexOf(1)).toBeGreaterThanOrEqual(0);
    expect(firstIndexOf(2)).toBeGreaterThan(firstIndexOf(1));
    expect(firstIndexOf(3)).toBeGreaterThan(firstIndexOf(2));

    // The chain never shrinks while accumulating.
    const beforeFinal = chainLengths.slice(0, chainLengths.indexOf(3) + 1);
    for (let i = 1; i < beforeFinal.length; i++) {
      expect(beforeFinal[i]).toBeGreaterThanOrEqual(beforeFinal[i - 1] as number);
    }

    // Verify turns via turn chain (Phase 2: no detail.turns array)
    expect(result.isError).toBe(false);
    const turnHead = getActiveTurnHead(uwf.store, THREAD_ID);
    expect(turnHead).not.toBeNull();
    const chain = walkTurnChain(uwf, turnHead!);
    expect(chain).toHaveLength(3);
    const contents = chain.map((h) => turnContent(uwf.store, h));
    expect(contents).toEqual(["t1", "t2", FINAL_TURN]);
    for (const h of chain) {
      const node = uwf.store.cas.get(h);
      expect((node?.payload as TurnNodePayload).role).toBe("assistant");
    }
  });

  // Step 2 — completion: detail has turnCount===3 (no turns array); turns via turnsOfStep.
  test("detail has turnCount===3 (no turns array); turns accessible via turnsOfStep", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await runStep(uwf, workflow, startHash, tmpDir);

    expect(result.isError).toBe(false);
    const detail = uwf.store.cas.get(result.detailHash)?.payload as {
      sessionId: string;
      duration: number;
      turnCount: number;
    };
    expect(detail.turnCount).toBe(3);
    expect((detail as Record<string, unknown>).turns).toBeUndefined(); // Phase 2: no turns array
    expect(detail.sessionId).toBe(SESSION_ID);
    expect(detail.duration).toBeGreaterThanOrEqual(0);

    // Get turns via turn chain
    const turnHead = getActiveTurnHead(uwf.store, THREAD_ID);
    expect(turnHead).not.toBeNull();

    // Get the step-start owner from first turn
    const firstTurn = uwf.store.cas.get(walkTurnChain(uwf, turnHead!)[0]!)
      ?.payload as TurnNodePayload;
    const stepStartHash = firstTurn.owner!;
    const stepTurns = turnsOfStep(uwf, turnHead!, stepStartHash);
    expect(stepTurns).toHaveLength(3);
    expect(stepTurns.map((h) => turnContent(uwf.store, h))).toEqual(["t1", "t2", FINAL_TURN]);

    // Role-keyed var is cleared (backward compat)
    const vars = uwf.varStore.list({ exactName: activeTurnsVarName(THREAD_ID, ROLE) });
    expect(vars).toEqual([]);

    // Backward-compat: frontmatter extraction still works
    expect(result.frontmatter).toEqual({ $status: "done", summary: "shipped" });
  });

  // Step 3 — crash-rerun: new step-start isolates old turns via different owner.
  test("crash-rerun: new step-start isolates old turns via different owner", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    // Seed a residual active var (two stale turns) from a "crashed" prior attempt.
    // Phase 2: these will be ignored because the new step gets a new step-start
    // with different owner hash.
    const turnSchemaHash = putSchema(uwf.store, {
      title: "broker-turn",
      type: "object" as const,
      required: ["role", "content"],
      properties: {
        role: { type: "string" as const, enum: ["assistant", "tool"] },
        content: { type: "string" as const },
      },
      additionalProperties: false,
    });
    for (const stale of ["old1", "old2"]) {
      const h = uwf.store.cas.put(turnSchemaHash, { role: "assistant", content: stale }) as CasRef;
      appendActiveTurn(uwf.store, THREAD_ID, ROLE, h);
    }
    expect(readActiveTurns(uwf.store, THREAD_ID, ROLE)).toHaveLength(2);

    const result = await runStep(uwf, workflow, startHash, tmpDir);

    expect(result.isError).toBe(false);
    const detail = uwf.store.cas.get(result.detailHash)?.payload as {
      turnCount: number;
    };
    // Only the new attempt's 3 turns counted
    expect(detail.turnCount).toBe(3);

    // Get the new step's turns via turnsOfStep
    const turnHead = getActiveTurnHead(uwf.store, THREAD_ID);
    expect(turnHead).not.toBeNull();

    // Get the step-start owner from the first new turn (will be the new step-start)
    const chain = walkTurnChain(uwf, turnHead!);
    // The chain includes ALL turns (old + new), but filtered by owner gives only new ones
    expect(chain.length).toBeGreaterThanOrEqual(3);

    // Find the new step-start (the one that owns the turns with content "t1", "t2", etc.)
    const newTurns = chain.filter((h) => {
      const c = turnContent(uwf.store, h);
      return c === "t1" || c === "t2" || c === FINAL_TURN;
    });
    expect(newTurns).toHaveLength(3);
    const newStepOwner = (uwf.store.cas.get(newTurns[0]!)?.payload as TurnNodePayload).owner!;
    const filteredTurns = turnsOfStep(uwf, turnHead!, newStepOwner);
    expect(filteredTurns).toHaveLength(3);
    const contents = filteredTurns.map((h) => turnContent(uwf.store, h));
    expect(contents).toEqual(["t1", "t2", FINAL_TURN]);
    expect(contents).not.toContain("old1");
    expect(contents).not.toContain("old2");

    // Role-keyed active var deleted after step.
    expect(uwf.varStore.list({ exactName: activeTurnsVarName(THREAD_ID, ROLE) })).toEqual([]);
  });

  // Step 4 — cross-process visibility via the thread-keyed turn head var.
  test("an independent reader sees the growing turn chain mid-flight", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const p = runStep(uwf, workflow, startHash, tmpDir);

    // Sample turn chain from independent reader while step runs
    const { counts, contents } = await sampleTurnChainWhileRunning(casDir, uwf, tmpDir, p);

    // Progress was visible before completion: a non-empty, growing chain.
    const maxObserved = Math.max(...counts);
    expect(maxObserved).toBeGreaterThanOrEqual(2);
    expect(counts.some((n) => n > 0 && n < 3)).toBe(true);
    expect(contents.has("t1")).toBe(true);

    // After completion the role-keyed var is gone
    const after = openReader(casDir);
    try {
      expect(
        after.store.var.list({ namePrefix: `${ACTIVE_TURNS_VAR_PREFIX}${THREAD_ID}/` }),
      ).toEqual([]);
    } finally {
      after.close();
    }

    // Thread-keyed turn head var still points to the chain
    const finalHead = getActiveTurnHead(uwf.store, THREAD_ID);
    expect(finalHead).not.toBeNull();
    expect(walkTurnChain(uwf, finalHead!)).toHaveLength(3);
  });
});

/**
 * Sample the turn chain from an independent reader while a step runs.
 * Returns observed chain lengths and contents.
 */
async function sampleTurnChainWhileRunning(
  casDir: string,
  uwf: UwfStore,
  tmpDir: string,
  stepPromise: Promise<unknown>,
): Promise<{ counts: number[]; contents: Set<string>; finished: boolean }> {
  const counts: number[] = [];
  const contents = new Set<string>();
  let finished = false;

  void stepPromise.finally(() => {
    finished = true;
  });

  while (!finished) {
    const reader = openReader(casDir);
    try {
      const head = getActiveTurnHead(reader.store, THREAD_ID);
      if (head !== null) {
        const chain = walkTurnChain(
          {
            store: reader.store,
            schemas: uwf.schemas,
            storageRoot: tmpDir,
            varStore: uwf.varStore,
          },
          head,
        );
        counts.push(chain.length);
        for (const h of chain) {
          const c = turnContent(reader.store, h);
          if (c !== null) contents.add(c);
        }
      } else {
        counts.push(0);
      }
    } finally {
      reader.close();
    }
    await delay(PER_TURN_MS / 3);
  }

  await stepPromise;
  return { counts, contents, finished };
}
