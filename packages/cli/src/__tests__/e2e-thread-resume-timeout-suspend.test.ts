/**
 * Spec 4 (issue #435, Phase 2) — verification contract for the RFC #95 loop
 * `timeout → suspend (checkpoint) → resume`.
 *
 * This is verification-only: NO resume code changed in Phase 2. The test proves
 * the *existing* `uwf thread resume` path already satisfies the timeout-suspend
 * resume contract by wiring the spec-3 producer to the resume consumer:
 *
 *   1. Drive a real sumeru send-timeout through `executeBrokerStep` (the SSE
 *      stream ends in `suspend`, exactly as Spec 3 verifies) so the thread's
 *      head step is a genuine `$status: "$SUSPEND"` node and the `(threadId,
 *      role)` broker session is mapped to the sumeru session.
 *   2. Seed the thread to `suspended` (mirroring what `finalizeAgentStep` does
 *      after a suspended broker step) and assert `cmdThreadShow` reports
 *      `suspended` with the timeout reason — a valid resume precondition.
 *   3. Call `cmdThreadResume`. Assert it is accepted, issues a FRESH
 *      `broker.send()` for the suspended role on the SAME mapped session (so the
 *      sumeru adapter resumes by `nativeId` rather than starting over), delivers
 *      the `-p` supplement as the continuation prompt, and — when that resumed
 *      send now completes (`kind:"completed"`) — advances the thread out of
 *      `suspended` (here straight to `end`).
 *
 * The second send is a `done` stream, so the gate opens and the thread proceeds;
 * if it had timed out again it would simply re-arm `suspended` (Spec 3 path),
 * never an error.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putSchema } from "@ocas/core";
import type { CasRef, ThreadId, WorkflowConfig, WorkflowPayload } from "@united-workforce/protocol";
import { createProcessLogger } from "@united-workforce/util";
import { getConfigPath } from "@united-workforce/util-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeBrokerStep, openBrokerSessionStore } from "../commands/broker-step.js";
import { cmdThreadResume, cmdThreadShow } from "../commands/thread.js";
import { createUwfStore, type UwfStore } from "../store.js";
import { seedThreads } from "./thread-test-helpers.js";

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
const SESSION_ID = "ses_resume_e2e";
const THREAD_ID = "06FCBROKERRESUMESTEP0001" as ThreadId;
const ROLE = "planner";
const NATIVE_ID = "ses_native_abc";
const ELAPSED_MS = 1800000;
const WORKFLOW_NAME = "broker-resume-e2e";
const SUPPLEMENT = "继续上次未完成的任务";

function buildConfig(): WorkflowConfig {
  return {
    agents: { [ALIAS]: { host: HOST, gateway: GATEWAY } },
    defaultAgent: ALIAS,
    agentOverrides: null,
  };
}

/**
 * Write the on-disk `config.yaml` that `cmdThreadResume` reloads via
 * `loadWorkflowConfig`. Must use the Phase-3 `{host, gateway}` shape (the
 * normalizer rejects the legacy `{command}` form).
 */
async function writeConfig(storageRoot: string): Promise<void> {
  const yaml = `defaultAgent: ${ALIAS}\nagentOverrides: null\nagents:\n  ${ALIAS}:\n    host: ${HOST}\n    gateway: ${GATEWAY}\n`;
  await writeFile(getConfigPath(storageRoot), yaml, "utf8");
}

async function buildWorkflow(uwf: UwfStore): Promise<{
  workflow: WorkflowPayload;
  startHash: CasRef;
}> {
  const frontmatterHash = (await putSchema(uwf.store, PLANNER_OUTPUT_SCHEMA)) as CasRef;
  const workflow: WorkflowPayload = {
    version: 1,
    name: WORKFLOW_NAME,
    description: "broker step resume end-to-end",
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
        // Non-empty $END prompt: the resumed `done` stream routes through the
        // post-step moderator, which rejects an empty edge template.
        done: { role: "$END", prompt: "done", location: null },
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
    sseFrame(3, "suspend", {
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
    context: { thread: THREAD_ID, workflow: WORKFLOW_NAME },
  });
}

describe("uwf thread resume — timeout-suspended thread resumes via fresh send (issue #435)", () => {
  let tmpDir: string;
  let savedOcasHome: string | undefined;
  let calls: FetchCall[];
  // First send (the step that suspends) → suspend stream; every send after the
  // first (the resume) → completed stream. A counter, not a swap, so the resume
  // genuinely re-enters the same stub.
  let messageCallCount: number;

  beforeEach(async () => {
    savedOcasHome = process.env.OCAS_HOME;
    tmpDir = await mkdtemp(join(tmpdir(), "broker-resume-e2e-"));
    process.env.OCAS_HOME = join(tmpDir, "cas");
    calls = [];
    messageCallCount = 0;
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
          messageCallCount += 1;
          return messageCallCount === 1 ? suspendStream() : completedStream();
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

  /**
   * Drive a real send-timeout through `executeBrokerStep`, then seed the thread
   * to `suspended` at the produced `$SUSPEND` step (mirroring `finalizeAgentStep`
   * after a suspended broker step). Returns the suspend step hash and reason.
   */
  async function suspendThread(
    uwf: UwfStore,
    workflow: WorkflowPayload,
    startHash: CasRef,
  ): Promise<{ suspendHash: CasRef; reason: string }> {
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

    const reason = (result.frontmatter as Record<string, unknown>).reason as string;
    await seedThreads(tmpDir, {
      [THREAD_ID]: {
        head: result.stepHash,
        status: "suspended",
        suspendedRole: ROLE,
        suspendMessage: reason,
        completedAt: null,
      },
    });
    return { suspendHash: result.stepHash, reason };
  }

  test("a timeout-suspended thread is shown as suspended, then resume advances it past the gate", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);
    await writeConfig(tmpDir);

    const { suspendHash, reason } = await suspendThread(uwf, workflow, startHash);

    // Precondition: the thread sits in `suspended` carrying the timeout reason.
    const show = await cmdThreadShow(tmpDir, THREAD_ID);
    expect(show.status).toBe("suspended");
    expect(show.suspendedRole).toBe(ROLE);
    expect(show.suspendMessage).toBe(reason);
    expect(show.suspendMessage as string).toContain(NATIVE_ID);

    // Resume is accepted and the resumed send completes, so the thread leaves
    // `suspended` and advances (here straight to `end` via the `done` edge).
    const resumeOut = await cmdThreadResume(tmpDir, THREAD_ID, SUPPLEMENT, null);
    expect(resumeOut.status).toBe("end");
    expect(resumeOut.done).toBe(true);
    expect(resumeOut.error).toBeNull();
    expect(resumeOut.head).not.toBe(suspendHash);

    // And `thread show` agrees the gate is gone.
    const showAfter = await cmdThreadShow(tmpDir, THREAD_ID);
    expect(showAfter.status).toBe("end");
    expect(showAfter.suspendedRole).toBeNull();
    expect(showAfter.suspendMessage).toBeNull();
  });

  test("resume issues a FRESH send reusing the SAME mapped session (no new createSession)", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);
    await writeConfig(tmpDir);

    await suspendThread(uwf, workflow, startHash);
    await cmdThreadResume(tmpDir, THREAD_ID, SUPPLEMENT, null);

    // Exactly ONE createSession (during the suspend) — resume reuses the cached
    // (threadId, role) → sessionId mapping rather than spawning a new session.
    const createCalls = calls.filter((c) => c.url.endsWith(`/gateways/${GATEWAY}/sessions`));
    expect(createCalls).toHaveLength(1);

    // TWO sends, both addressed to the SAME session id: the suspended send and
    // the resume continuation. The sumeru adapter resumes by nativeId off this
    // shared session.
    const messageCalls = calls.filter((c) => c.url.endsWith("/messages"));
    expect(messageCalls).toHaveLength(2);
    for (const call of messageCalls) {
      expect(call.url).toContain(`/sessions/${SESSION_ID}/messages`);
    }

    // The broker session row still points at the same session for a future resume.
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

  test("the -p supplement is delivered as the continuation prompt on the resume send", async () => {
    const uwf = await createUwfStore(tmpDir);
    const { workflow, startHash } = await buildWorkflow(uwf);
    await writeConfig(tmpDir);

    await suspendThread(uwf, workflow, startHash);
    await cmdThreadResume(tmpDir, THREAD_ID, SUPPLEMENT, null);

    const messageCalls = calls.filter((c) => c.url.endsWith("/messages"));
    const resumeSend = messageCalls[1];
    expect(resumeSend).toBeDefined();
    // The resume prompt = suspend reason + the operator supplement; both ride
    // the assembled prompt body of the continuation send.
    expect(resumeSend?.body).toContain(SUPPLEMENT);
    expect(resumeSend?.body).toContain(NATIVE_ID);
  });
});
