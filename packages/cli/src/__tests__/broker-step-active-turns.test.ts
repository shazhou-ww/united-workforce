/**
 * Phase 2 (#398) — realtime turn persistence in `executeBrokerStep`.
 *
 * Covers the four acceptance steps of issue #398:
 *   Step 1 — broker-step's `onTurn` appends each assistant turn to
 *            `@uwf/active-turns/<tid>/<role>` in real time; the list grows 1→2→3.
 *   Step 2 — on completion `storeBrokerDetail` solidifies the full list into the
 *            immutable detail (`detail.turns.length===3`, `turnCount===3`) and
 *            deletes the active var.
 *   Step 3 — a crash-rerun is a fresh attempt: the active var is cleared at the
 *            start of the step, so stale turns are dropped (detail holds only the
 *            new 3).
 *   Step 4 — cross-process visibility: an independent reader (fresh CAS + fresh
 *            SQLite connection) sees the growing turn list mid-flight via the
 *            SQLite-backed `@uwf/active-turns/<tid>/<role>` var, and an empty
 *            result after the step solidifies.
 *
 * The Sumeru HTTP layer is stubbed via `globalThis.fetch` (mirrors
 * `e2e-broker-step.test.ts`); a *paced* SSE stream emits one assistant turn per
 * `PER_TURN_MS` so concurrent readers can observe intermediate state.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema, type Store } from "@ocas/core";
import { createFsStore, createSqliteVarStore } from "@ocas/fs";
import type { CasRef, ThreadId, WorkflowConfig, WorkflowPayload } from "@united-workforce/protocol";
import { createProcessLogger } from "@united-workforce/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeBrokerStep } from "../commands/broker-step.js";
import {
  ACTIVE_TURNS_VAR_PREFIX,
  activeTurnsVarName,
  appendActiveTurn,
  createUwfStore,
  readActiveTurns,
  type UwfStore,
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

  // Step 1 — the active var grows 1 → 2 → 3 as onTurn fires.
  test("active var grows 1 -> 2 -> 3 in arrival order as turns stream", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const p = runStep(uwf, workflow, startHash, tmpDir);

    // Sample the (same-process) active var while the step is in flight.
    const lengths: number[] = [];
    let finished = false;
    void p.finally(() => {
      finished = true;
    });
    while (!finished) {
      lengths.push(readActiveTurns(uwf.store, THREAD_ID, ROLE).length);
      await delay(PER_TURN_MS / 4);
    }
    const result = await p;

    // Monotonic growth: first occurrences of 1, 2, 3 appear in order.
    const firstIndexOf = (n: number) => lengths.indexOf(n);
    expect(firstIndexOf(1)).toBeGreaterThanOrEqual(0);
    expect(firstIndexOf(2)).toBeGreaterThan(firstIndexOf(1));
    expect(firstIndexOf(3)).toBeGreaterThan(firstIndexOf(2));

    // The list never shrinks while accumulating (ignore the post-solidify drop
    // to 0, which only ever appears after we have already observed 3).
    const beforeFinal = lengths.slice(0, lengths.indexOf(3) + 1);
    for (let i = 1; i < beforeFinal.length; i++) {
      expect(beforeFinal[i]).toBeGreaterThanOrEqual(beforeFinal[i - 1] as number);
    }

    // The solidified detail proves the final ordered set of 3 turn hashes,
    // each gettable as a pure {role, content} node.
    expect(result.isError).toBe(false);
    const detail = uwf.store.cas.get(result.detailHash)?.payload as {
      turns: CasRef[];
      turnCount: number;
    };
    expect(detail.turns).toHaveLength(3);
    const contents = detail.turns.map((h) => turnContent(uwf.store, h));
    expect(contents).toEqual(["t1", "t2", FINAL_TURN]);
    for (const h of detail.turns) {
      const node = uwf.store.cas.get(h);
      expect((node?.payload as Record<string, unknown>).role).toBe("assistant");
    }
  });

  // Step 2 — completion solidifies the full list and deletes the active var.
  test("storeBrokerDetail solidifies turns.length===3 / turnCount===3 and deletes active var", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await runStep(uwf, workflow, startHash, tmpDir);

    expect(result.isError).toBe(false);
    const detail = uwf.store.cas.get(result.detailHash)?.payload as {
      sessionId: string;
      duration: number;
      turnCount: number;
      turns: CasRef[];
    };
    expect(detail.turnCount).toBe(3);
    expect(detail.turns).toHaveLength(3);
    expect(detail.turns.map((h) => turnContent(uwf.store, h))).toEqual(["t1", "t2", FINAL_TURN]);
    expect(detail.sessionId).toBe(SESSION_ID);
    expect(detail.duration).toBeGreaterThanOrEqual(0);

    // The mutable pointer is gone once frozen into the immutable detail.
    const vars = uwf.varStore.list({ exactName: activeTurnsVarName(THREAD_ID, ROLE) });
    expect(vars).toEqual([]);

    // Backward-compat: the last solidified turn is still the final answer the
    // legacy seal-style path would have surfaced.
    expect(result.frontmatter).toEqual({ $status: "done", summary: "shipped" });
  });

  // Step 3 — a crash-rerun is a fresh attempt: stale turns are dropped.
  test("crash-rerun clears a residual active var; detail holds only the new 3", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    // Seed a residual active var (two stale turns) from a "crashed" prior attempt.
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
      turns: CasRef[];
    };
    // Only the new attempt's 3 turns survive — the stale 2 were cleared, never
    // appended onto.
    expect(detail.turnCount).toBe(3);
    expect(detail.turns).toHaveLength(3);
    const contents = detail.turns.map((h) => turnContent(uwf.store, h));
    expect(contents).toEqual(["t1", "t2", FINAL_TURN]);
    expect(contents).not.toContain("old1");
    expect(contents).not.toContain("old2");

    // Active var deleted after solidification.
    expect(uwf.varStore.list({ exactName: activeTurnsVarName(THREAD_ID, ROLE) })).toEqual([]);
  });

  // Step 4 — cross-process visibility via the SQLite-backed active var.
  test("an independent reader sees the growing turn list mid-flight, empty after completion", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const p = runStep(uwf, workflow, startHash, tmpDir);

    // "Process B": sample the active var from a fresh CAS + SQLite connection,
    // resolving each turn hash to its content to prove genuine cross-process
    // readability while "process A" is still running.
    const observedCounts: number[] = [];
    const observedContents = new Set<string>();
    let finished = false;
    void p.finally(() => {
      finished = true;
    });
    while (!finished) {
      const reader = openReader(casDir);
      try {
        const turns = readActiveTurns(reader.store, THREAD_ID, ROLE);
        observedCounts.push(turns.length);
        for (const h of turns) {
          const c = turnContent(reader.store, h);
          if (c !== null) observedContents.add(c);
        }
      } finally {
        reader.close();
      }
      await delay(PER_TURN_MS / 3);
    }
    const result = await p;

    // Progress was visible before completion: a non-empty, growing list.
    const maxObserved = Math.max(...observedCounts);
    expect(maxObserved).toBeGreaterThanOrEqual(2);
    expect(observedCounts.some((n) => n > 0 && n < 3)).toBe(true);
    // Intermediate content produced by process A was readable by process B.
    expect(observedContents.has("t1")).toBe(true);

    // After completion the active var is gone (solidified + deleted)…
    const after = openReader(casDir);
    try {
      expect(
        after.store.var.list({ namePrefix: `${ACTIVE_TURNS_VAR_PREFIX}${THREAD_ID}/` }),
      ).toEqual([]);
    } finally {
      after.close();
    }
    // …and the same turns are now durable under the step's immutable detail.
    const detail = uwf.store.cas.get(result.detailHash)?.payload as { turns: CasRef[] };
    expect(detail.turns).toHaveLength(3);
  });
});
