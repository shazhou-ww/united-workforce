/**
 * Tests for `broker.send()` returning a discriminated `SendResult` (issue
 * #435, Phase 2): `kind:"completed"` (with `done`) vs `kind:"suspended"`
 * (with `reason`/`nativeId`/`elapsedMs`, no `done`).
 *
 * The completed branch is a pure additive rename — same values as before plus
 * a `kind` tag. The suspended branch carries the suspend metadata and the
 * turns gathered before the timeout, and the session mapping is still upserted
 * (the future resume reuses it).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  type AgentRoute,
  type CreateSessionArgs,
  createBroker,
  createSessionStore,
  type SendMessageArgs,
  type SessionStore,
  type SumeruClient,
  type SumeruSendOutcome,
} from "../src/index.js";

const THREAD_A = "06FCHRTFS6STQY3ET1355NXYS0";
const HOST_A = "http://127.0.0.1:7900";

function constantRoute(host: string, gateway: string, cwd: string | null = null): AgentRoute {
  return { host, gateway, cwd };
}

function turn(content: string) {
  return {
    index: 1,
    role: "assistant" as const,
    content,
    timestamp: "",
    toolCalls: null,
    tokens: null,
    hash: null,
  };
}

function completedOutcome(contents: string[]): SumeruSendOutcome {
  const last = contents[contents.length - 1] ?? "";
  return {
    kind: "completed",
    output: last,
    assistantTurnCount: contents.length,
    assistantTurns: contents.map(turn),
    done: { turnCount: 2, tokens: { in: 10, out: 5 }, durationMs: 1500 },
  };
}

function suspendedOutcome(contents: string[]): SumeruSendOutcome {
  return {
    kind: "suspended",
    assistantTurns: contents.map(turn),
    suspend: { reason: "timeout", nativeId: "ses_native_abc", elapsedMs: 1800000 },
  };
}

function fakeFactory(
  outcome: SumeruSendOutcome,
  newSessionId: string,
): (host: string) => SumeruClient {
  return (_host: string): SumeruClient =>
    Object.freeze({
      async createSession(_args: CreateSessionArgs): Promise<string> {
        return newSessionId;
      },
      async sendMessage(_args: SendMessageArgs): Promise<SumeruSendOutcome> {
        return outcome;
      },
    });
}

describe("broker.send — discriminated SendResult (issue #435)", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-send-union-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("completed outcome → kind:'completed' with output/done/turns (additive rename)", async () => {
    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "claude-code"),
      clientFactory: fakeFactory(completedOutcome(["draft1", "draft2", "final"]), "ses_fresh"),
    });

    const result = await broker.send({
      threadId: THREAD_A,
      role: "planner",
      prompt: "go",
      onTurn: null,
    });

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("expected completed");
    expect(result.output).toBe("final");
    expect(result.assistantTurnCount).toBe(3);
    expect(result.turns.map((t) => t.content)).toEqual(["draft1", "draft2", "final"]);
    expect(result.done.turnCount).toBe(2);
    expect(result.sessionId).toBe("ses_fresh");
    expect(result.reused).toBe(false);
  });

  test("suspended outcome → kind:'suspended' with reason/nativeId/elapsedMs, no done", async () => {
    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "claude-code"),
      clientFactory: fakeFactory(suspendedOutcome(["draft1", "draft2"]), "ses_fresh"),
    });

    const result = await broker.send({
      threadId: THREAD_A,
      role: "planner",
      prompt: "long task",
      onTurn: null,
    });

    expect(result.kind).toBe("suspended");
    if (result.kind !== "suspended") throw new Error("expected suspended");
    expect(result.reason).toBe("timeout");
    expect(result.nativeId).toBe("ses_native_abc");
    expect(result.elapsedMs).toBe(1800000);
    expect(result.sessionId).toBe("ses_fresh");
    expect(result.turns.map((t) => t.content)).toEqual(["draft1", "draft2"]);
    // No `done`/`output`/`assistantTurnCount` on the suspended branch.
    expect("done" in result).toBe(false);
    expect("output" in result).toBe(false);
    expect("assistantTurnCount" in result).toBe(false);
  });

  test("suspended send still upserts the (threadId, role) session mapping for resume", async () => {
    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "claude-code"),
      clientFactory: fakeFactory(suspendedOutcome(["partial"]), "ses_suspended"),
    });

    await broker.send({
      threadId: THREAD_A,
      role: "planner",
      prompt: "long task",
      onTurn: null,
    });

    const row = store.getSession(THREAD_A, "planner");
    expect(row?.sessionId).toBe("ses_suspended");
    expect(row?.host).toBe(HOST_A);
    expect(row?.gateway).toBe("claude-code");
  });
});
