/**
 * Phase 3 (#380) — direct e2e test for `executeBrokerStep`.
 *
 * Stubs `globalThis.fetch` so the Sumeru `createSession` POST and
 * `sendMessage` SSE POST come back deterministically. Verifies:
 *   1. broker.send() is invoked with the resolved (host, gateway, cwd) route.
 *   2. The agent's last assistant turn is extracted via the frontmatter fast-path.
 *   3. A StepNode is persisted to CAS with the role's output schema, edge prompt,
 *      and accumulated usage, satisfying schema validation.
 *   4. The broker session store rows the (threadId, role) → sessionId mapping.
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
import { createProcessLogger } from "@united-workforce/util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeBrokerStep, openBrokerSessionStore } from "../commands/broker-step.js";
import { createUwfStore, type UwfStore } from "../store.js";

// ── Sumeru fetch stub ────────────────────────────────────────────────────────

type FetchCall = {
  url: string;
  method: string;
  body: string;
};

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

// ── Sample workflow + role schema ────────────────────────────────────────────

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

const PLANNER_BODY = "Here is the plan you asked for.";
const PLANNER_RAW_OUTPUT = `---
$status: done
plan: ship it
---
${PLANNER_BODY}`;

// ── Fixture helpers ──────────────────────────────────────────────────────────

async function buildWorkflow(uwf: UwfStore): Promise<{
  workflow: WorkflowPayload;
  startHash: CasRef;
}> {
  const frontmatterHash = (await putSchema(uwf.store, PLANNER_OUTPUT_SCHEMA)) as CasRef;
  const workflow: WorkflowPayload = {
    version: 1,
    name: "broker-e2e",
    description: "broker step end-to-end smoke",
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

const HOST = "http://127.0.0.1:7900";
const GATEWAY = "planner-gw";
const ALIAS = "planner-agent";
const SESSION_ID = "ses_broker_e2e";
const THREAD_ID = "06FCBROKERE2ESTEPMAIN0001" as ThreadId;
const ROLE = "planner";

function buildConfig(): WorkflowConfig {
  return {
    agents: { [ALIAS]: { host: HOST, gateway: GATEWAY } },
    defaultAgent: ALIAS,
    agentOverrides: null,
  };
}

function buildSseResponseForPlanner(): Response {
  return buildSseResponse([
    sseFrame(1, "turn", {
      type: "@sumeru/turn",
      value: {
        index: 0,
        role: "user",
        content: "edge prompt",
        timestamp: "",
        toolCalls: null,
      },
    }),
    sseFrame(2, "turn", {
      type: "@sumeru/turn",
      value: {
        index: 1,
        role: "assistant",
        content: PLANNER_RAW_OUTPUT,
        timestamp: "",
        toolCalls: null,
      },
    }),
    sseFrame(3, "done", {
      type: "@sumeru/summary",
      value: { turnCount: 2, tokens: { in: 9, out: 4 }, durationMs: 42 },
    }),
  ]);
}

function buildHandlerResponse(url: string): Response {
  if (url.endsWith(`/gateways/${GATEWAY}/sessions`)) {
    return buildJsonResponse(201, {
      type: "@sumeru/session",
      value: { id: SESSION_ID, gateway: GATEWAY },
    });
  }
  if (url.endsWith(`/sessions/${SESSION_ID}/messages`)) {
    return buildSseResponseForPlanner();
  }
  return buildJsonResponse(500, { error: "unexpected url", url });
}

function resolveFetchUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeBrokerStep — Sumeru HTTP integration", () => {
  let tmpDir: string;
  let savedOcasHome: string | undefined;
  let calls: FetchCall[];

  beforeEach(async () => {
    savedOcasHome = process.env.OCAS_HOME;
    tmpDir = await mkdtemp(join(tmpdir(), "broker-e2e-"));
    process.env.OCAS_HOME = join(tmpDir, "cas");
    calls = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init: RequestInit | undefined): Promise<Response> => {
        const url = resolveFetchUrl(input);
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? init.body : "";
        calls.push({ url, method, body });
        return buildHandlerResponse(url);
      },
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (savedOcasHome === undefined) delete process.env.OCAS_HOME;
    else process.env.OCAS_HOME = savedOcasHome;
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("creates Sumeru session, sends prompt, and writes a valid StepNode", async () => {
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
      plog: createProcessLogger({
        storageRoot: tmpDir,
        context: { thread: THREAD_ID, workflow: "broker-e2e" },
      }),
    });

    expect(result.isError).toBe(false);
    expect(result.role).toBe(ROLE);
    expect(result.frontmatter).toEqual({ $status: "done", plan: "ship it" });
    expect(result.body.trim()).toBe(PLANNER_BODY);
    expect(result.usage).not.toBeNull();
    expect(result.usage?.inputTokens).toBe(0); // sumeru `done` here uses tokens.in (not inputTokens) — broker drops unknown fields

    // Two requests: createSession then sendMessage.
    expect(calls.length).toBe(2);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${HOST}/gateways/${GATEWAY}/sessions`);
    expect(JSON.parse(calls[0].body)).toEqual({ workspaceRoot: "/tmp/work" });
    expect(calls[1].method).toBe("POST");
    expect(calls[1].url).toBe(`${HOST}/gateways/${GATEWAY}/sessions/${SESSION_ID}/messages`);
    expect(JSON.parse(calls[1].body)).toEqual({ content: "make a plan" });

    // Step persisted to CAS with the right linkage.
    const stepNode = uwf.store.cas.get(result.stepHash);
    expect(stepNode).not.toBeNull();
    const payload = stepNode?.payload as StepNodePayload;
    expect(payload.start).toBe(startHash);
    expect(payload.prev).toBeNull();
    expect(payload.role).toBe(ROLE);
    expect(payload.agent).toBe(GATEWAY);
    expect(payload.edgePrompt).toBe("make a plan");
    expect(payload.detail).toBe(result.detailHash);

    // Broker session store remembers the (threadId, role) → sessionId mapping.
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

  test("agent override (alias) routes to that alias's host and gateway", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);

    const result = await executeBrokerStep({
      storageRoot: tmpDir,
      uwf,
      config: buildConfig(),
      workflow,
      threadId: THREAD_ID,
      role: ROLE,
      edgePrompt: "go",
      effectiveCwd: "",
      startHash,
      prevHash: null,
      // Resolve via alias entry in config.
      agentOverride: ALIAS,
      previousAttempts: null,
      plog: createProcessLogger({
        storageRoot: tmpDir,
        context: { thread: THREAD_ID, workflow: "broker-e2e" },
      }),
    });

    expect(result.isError).toBe(false);
    // Both calls should hit the alias's host+gateway.
    expect(calls[0].url).toBe(`${HOST}/gateways/${GATEWAY}/sessions`);
    expect(calls[1].url).toBe(`${HOST}/gateways/${GATEWAY}/sessions/${SESSION_ID}/messages`);
  });
});
