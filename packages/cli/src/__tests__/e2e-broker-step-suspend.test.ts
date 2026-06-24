/**
 * Spec 3 (issue #435, Phase 2) — `executeBrokerStep` routes a broker
 * `kind:"suspended"` SendResult through the existing `$SUSPEND` exit.
 *
 * Stubs `globalThis.fetch` so the Sumeru `sendMessage` SSE stream ends in a
 * `suspend` terminal event (send timeout) rather than `done`. Verifies:
 *   1. `executeBrokerStep` takes the suspended branch (NOT the frontmatter
 *      retry / error path) and returns `isError === false` with
 *      `frontmatter.$status === "$SUSPEND"`.
 *   2. The persisted StepNode's output node validates as a suspend output
 *      (`$status: "$SUSPEND"`, non-empty `reason` carrying the timeout +
 *      nativeId), so thread status resolves to `suspended`.
 *   3. `nativeId` / `elapsedMs` are recorded on the detail node for diagnostics.
 *   4. The completed path is unchanged (regression): a `done` stream still
 *      extracts frontmatter and reports usage.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import type {
  CasRef,
  StepNodePayload,
  ThreadId,
  WorkflowConfig,
  WorkflowPayload,
} from "@united-workforce/protocol";
import { SUSPEND_STATUS } from "@united-workforce/protocol";
import { createProcessLogger } from "@united-workforce/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeBrokerStep, openBrokerSessionStore } from "../commands/broker-step.js";
import { createUwfStore, type UwfStore } from "../store.js";

type FetchCall = { url: string; method: string; body: string };

function sseFrame(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildSseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
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

const PLANNER_OUTPUT_SCHEMA = {
  title: "planner-output",
  type: "object" as const,
  required: ["$status", "plan"],
  properties: {
    $status: { type: "string" as const, enum: ["done", "failed"] },
    plan: { type: "string" as const },
  },
  additionalProperties: false,
};

const PLANNER_RAW_OUTPUT = `---
$status: done
plan: ship it
---
the plan body`;

const HOST = "http://127.0.0.1:7900";
const GATEWAY = "planner-gw";
const ALIAS = "planner-agent";
const SESSION_ID = "ses_suspend_e2e";
const THREAD_ID = "06FCBROKERSUSPENDSTEP0001" as ThreadId;
const ROLE = "planner";
const NATIVE_ID = "ses_native_abc";
const ELAPSED_MS = 1800000;

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
  const frontmatterHash = (await putSchema(uwf.store, PLANNER_OUTPUT_SCHEMA)) as CasRef;
  const workflow: WorkflowPayload = {
    version: 1,
    name: "broker-suspend-e2e",
    description: "broker step suspend end-to-end",
    roles: {
      planner: {
        description: "plans things",
        goal: "produce a plan",
        capabilities: [],
        procedure: "think hard",
        output: "frontmatter+body",
        frontmatter: frontmatterHash,
      },
    },
    graph: {
      planner: {
        done: { role: "$END", prompt: "", location: null },
      },
    },
  };
  const startHash = (await uwf.store.cas.put(uwf.schemas.startNode, {
    workflow: await uwf.store.cas.put(uwf.schemas.workflow, workflow),
    prompt: "p",
    cwd: "/tmp/work",
  })) as CasRef;
  return { workflow, startHash };
}

function suspendStream(): Response {
  return buildSseResponse([
    sseFrame(1, "turn", {
      type: "@sumeru/turn",
      value: { index: 0, role: "user", content: "edge prompt", timestamp: "", toolCalls: null },
    }),
    sseFrame(2, "turn", {
      type: "@sumeru/turn",
      value: { index: 1, role: "assistant", content: "draft1", timestamp: "", toolCalls: null },
    }),
    sseFrame(3, "turn", {
      type: "@sumeru/turn",
      value: { index: 2, role: "assistant", content: "draft2", timestamp: "", toolCalls: null },
    }),
    sseFrame(4, "suspend", {
      type: "@sumeru/suspend",
      value: { reason: "timeout", nativeId: NATIVE_ID, elapsedMs: ELAPSED_MS },
    }),
  ]);
}

function completedStream(): Response {
  return buildSseResponse([
    sseFrame(1, "turn", {
      type: "@sumeru/turn",
      value: {
        index: 1,
        role: "assistant",
        content: PLANNER_RAW_OUTPUT,
        timestamp: "",
        toolCalls: null,
      },
    }),
    sseFrame(2, "done", {
      type: "@sumeru/summary",
      value: { turnCount: 2, tokens: { in: 9, out: 4 }, durationMs: 42 },
    }),
  ]);
}

function resolveFetchUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function makePlog(tmpDir: string) {
  return createProcessLogger({
    storageRoot: tmpDir,
    context: { thread: THREAD_ID, workflow: "broker-suspend-e2e" },
  });
}

describe("executeBrokerStep — suspended SendResult → thread suspended (issue #435)", () => {
  let tmpDir: string;
  let savedOcasHome: string | undefined;
  let calls: FetchCall[];
  let messageResponse: () => Response;

  beforeEach(async () => {
    savedOcasHome = process.env.OCAS_HOME;
    tmpDir = await mkdtemp(join(tmpdir(), "broker-suspend-e2e-"));
    process.env.OCAS_HOME = join(tmpDir, "cas");
    calls = [];
    messageResponse = suspendStream;
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init: RequestInit | undefined): Promise<Response> => {
        const url = resolveFetchUrl(input);
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? init.body : "";
        calls.push({ url, method, body });
        if (url.endsWith(`/gateways/${GATEWAY}/sessions`)) {
          return buildJsonResponse(201, {
            type: "@sumeru/session",
            value: { id: SESSION_ID, gateway: GATEWAY },
          });
        }
        if (url.endsWith(`/sessions/${SESSION_ID}/messages`)) {
          return messageResponse();
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

  test("a suspend stream yields a $SUSPEND step (isError=false), not an error step", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await executeBrokerStep({
      storageRoot: tmpDir,
      uwf,
      config: buildConfig(),
      workflow,
      threadId: THREAD_ID,
      role: ROLE,
      edgePrompt: "make a plan",
      effectiveCwd: "/tmp/work",
      startHash,
      prevHash: null,
      agentOverride: null,
      previousAttempts: null,
      plog: makePlog(tmpDir),
    });

    expect(result.isError).toBe(false);
    expect(result.errorMessage).toBeNull();
    expect(result.frontmatter.$status).toBe(SUSPEND_STATUS);

    // Only TWO HTTP calls — createSession + ONE sendMessage. No frontmatter
    // retry send happened (suspend is a human gate, not a frontmatter failure).
    const messageCalls = calls.filter((c) => c.url.endsWith("/messages"));
    expect(messageCalls).toHaveLength(1);

    // The persisted StepNode's output node validates as a suspend output:
    // `$status: "$SUSPEND"` with a non-empty reason carrying the timeout info.
    const stepNode = uwf.store.cas.get(result.stepHash);
    expect(stepNode).not.toBeNull();
    const payload = stepNode?.payload as StepNodePayload;
    const outputNode = uwf.store.cas.get(payload.output);
    expect(outputNode).not.toBeNull();
    const output = outputNode?.payload as Record<string, unknown>;
    expect(output.$status).toBe(SUSPEND_STATUS);
    expect(typeof output.reason).toBe("string");
    expect(output.reason as string).toContain(String(ELAPSED_MS));
    expect(output.reason as string).toContain(NATIVE_ID);
  });

  test("detail node records nativeId and elapsedMs for diagnostics", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await executeBrokerStep({
      storageRoot: tmpDir,
      uwf,
      config: buildConfig(),
      workflow,
      threadId: THREAD_ID,
      role: ROLE,
      edgePrompt: "make a plan",
      effectiveCwd: "/tmp/work",
      startHash,
      prevHash: null,
      agentOverride: null,
      previousAttempts: null,
      plog: makePlog(tmpDir),
    });

    const detailNode = uwf.store.cas.get(result.detailHash);
    expect(detailNode).not.toBeNull();
    const detail = detailNode?.payload as Record<string, unknown>;
    expect(detail.nativeId).toBe(NATIVE_ID);
    expect(detail.elapsedMs).toBe(ELAPSED_MS);
    expect(detail.sessionId).toBe(SESSION_ID);
  });

  test("the (threadId, role) session mapping is upserted for the future resume", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    await executeBrokerStep({
      storageRoot: tmpDir,
      uwf,
      config: buildConfig(),
      workflow,
      threadId: THREAD_ID,
      role: ROLE,
      edgePrompt: "make a plan",
      effectiveCwd: "/tmp/work",
      startHash,
      prevHash: null,
      agentOverride: null,
      previousAttempts: null,
      plog: makePlog(tmpDir),
    });

    const sessionStore = openBrokerSessionStore(tmpDir);
    try {
      const row = sessionStore.getSession(THREAD_ID, ROLE);
      expect(row?.sessionId).toBe(SESSION_ID);
      expect(row?.host).toBe(HOST);
      expect(row?.gateway).toBe(GATEWAY);
    } finally {
      sessionStore.close();
    }
  });

  test("regression: a completed (done) stream still extracts frontmatter + usage", async () => {
    messageResponse = completedStream;
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await executeBrokerStep({
      storageRoot: tmpDir,
      uwf,
      config: buildConfig(),
      workflow,
      threadId: THREAD_ID,
      role: ROLE,
      edgePrompt: "make a plan",
      effectiveCwd: "/tmp/work",
      startHash,
      prevHash: null,
      agentOverride: null,
      previousAttempts: null,
      plog: makePlog(tmpDir),
    });

    expect(result.isError).toBe(false);
    expect(result.frontmatter).toEqual({ $status: "done", plan: "ship it" });
    expect(result.usage?.inputTokens).toBe(9);
    expect(result.usage?.outputTokens).toBe(4);
    expect(result.usage?.turns).toBe(2);
  });
});
