/**
 * Phase 1 (issue #397) — per-turn realtime callback + `SendResult.turns`.
 *
 * These tests drive `broker.send()` through the REAL `createSumeruClient`
 * (default factory) over an `installFetchStub` SSE stream, so the whole
 * plumbing chain is exercised end-to-end:
 *
 *   SendArgs.onTurn → sendMessage → consumeSse (fires onTurn) → SendResult.turns
 *
 * Covers issue #397's three acceptance steps:
 *   1. onTurn fires once per assistant turn, in arrival order, byte-exact
 *      content, non-empty hash, all before send() resolves.
 *   2. SendResult.turns is the full ordered assistant-turn list; invariants
 *      turns.length === assistantTurnCount and turns[last].content === output.
 *   3. onTurn=null preserves pre-Phase-1 behavior; non-assistant turns never
 *      fire the callback.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type AgentRoute,
  type Broker,
  type BrokerTurn,
  createBroker,
  createSessionStore,
  type SessionStore,
} from "../src/index.js";
import { type FetchResponseSpec, installFetchStub, sseFrame } from "./fetch-stub.js";

const THREAD = "06FCHRTFS6STQY3ET1355NXYS0";
const HOST = "http://127.0.0.1:7900";
const GATEWAY = "claude-code";

function constantRoute(): AgentRoute {
  return { host: HOST, gateway: GATEWAY, cwd: null };
}

/** A turn SSE frame with a non-empty Sumeru-computed hash. */
function turnFrame(
  id: number,
  index: number,
  role: "user" | "assistant" | "system",
  content: string,
  hash: string | null = `h_${index}`,
): string {
  return sseFrame(id, "turn", {
    type: "@sumeru/turn",
    value: {
      index,
      role,
      content,
      timestamp: `2026-01-01T00:00:0${index}Z`,
      toolCalls: null,
      hash,
    },
  });
}

function doneFrame(id: number, turnCount: number): string {
  return sseFrame(id, "done", {
    type: "@sumeru/summary",
    value: { turnCount, tokens: { in: 10, out: 5 }, durationMs: 1500 },
  });
}

/**
 * Install a handler that answers the createSession POST with a JSON session
 * and the sendMessage POST with the supplied SSE frames.
 */
function wireStream(
  fetchStub: { setHandler: (h: (call: { url: string }) => FetchResponseSpec) => void },
  frames: string[],
): void {
  fetchStub.setHandler((call) => {
    if (call.url.endsWith("/sessions")) {
      return {
        kind: "json",
        status: 200,
        body: { type: "@sumeru/session", value: { id: "ses_fresh" } },
      };
    }
    return { kind: "sse", status: 200, frames };
  });
}

describe("broker.send — Phase 1 onTurn realtime callback (#397 Step 1)", () => {
  const fetchStub = installFetchStub();
  let dir: string;
  let store: SessionStore;
  let broker: Broker;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-onturn-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
    broker = createBroker({
      sessionStore: store,
      resolveRoute: constantRoute,
      clientFactory: null, // use the REAL createSumeruClient over the fetch stub
    });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("fires onTurn once per assistant turn, byte-exact content, non-empty hash, in order", async () => {
    wireStream(fetchStub, [
      turnFrame(1, 0, "user", "the question"),
      turnFrame(2, 1, "assistant", "alpha", "ha"),
      turnFrame(3, 2, "assistant", "  bravo  with   spaces\n", "hb"),
      turnFrame(4, 3, "assistant", "charlie", "hc"),
      doneFrame(5, 4),
    ]);

    const seen: BrokerTurn[] = [];
    const result = await broker.send({
      threadId: THREAD,
      role: "planner",
      prompt: "go",
      onTurn: (t) => {
        seen.push(t);
      },
    });

    // N assistant turns => N callbacks (the leading user turn does NOT fire).
    expect(seen).toHaveLength(3);
    // Byte-for-byte content, no trimming / re-parse.
    expect(seen.map((t) => t.content)).toEqual(["alpha", "  bravo  with   spaces\n", "charlie"]);
    // Each delivered turn is an assistant turn with a non-empty hash.
    for (const t of seen) {
      expect(t.role).toBe("assistant");
      expect(t.hash).not.toBe("");
      expect(t.hash).not.toBeNull();
    }
    expect(seen.map((t) => t.hash)).toEqual(["ha", "hb", "hc"]);
    // Arrival order: assistant index monotonically non-decreasing.
    const indices = seen.map((t) => t.index);
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1] as number);
    }
    // All callbacks completed BEFORE send() resolved.
    expect(result.output).toBe("charlie");
    expect(result.assistantTurnCount).toBe(3);
  });

  test("the last onTurn content equals the resolved output", async () => {
    wireStream(fetchStub, [
      turnFrame(1, 0, "assistant", "first", "h0"),
      turnFrame(2, 1, "assistant", "last-one", "h1"),
      doneFrame(3, 2),
    ]);

    let lastSeen: string | null = null;
    const result = await broker.send({
      threadId: THREAD,
      role: "planner",
      prompt: "go",
      onTurn: (t) => {
        lastSeen = t.content;
      },
    });

    expect(lastSeen).toBe("last-one");
    expect(result.output).toBe("last-one");
  });
});

describe("broker.send — Phase 1 SendResult.turns (#397 Step 2)", () => {
  const fetchStub = installFetchStub();
  let dir: string;
  let store: SessionStore;
  let broker: Broker;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-turns-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
    broker = createBroker({
      sessionStore: store,
      resolveRoute: constantRoute,
      clientFactory: null,
    });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("turns is the full ordered assistant list; output is the last; user turn excluded", async () => {
    wireStream(fetchStub, [
      turnFrame(1, 0, "user", "prompt-echo"),
      turnFrame(2, 1, "assistant", "draft1", "hd1"),
      turnFrame(3, 2, "assistant", "draft2", "hd2"),
      turnFrame(4, 3, "assistant", "final", "hf"),
      doneFrame(5, 4),
    ]);

    const result = await broker.send({
      threadId: THREAD,
      role: "planner",
      prompt: "go",
      onTurn: null,
    });

    // Invariant: turns.length === assistantTurnCount (== 3, user excluded).
    expect(result.turns).toHaveLength(3);
    expect(result.turns.length).toBe(result.assistantTurnCount);
    // Invariant: last turn content === output.
    expect(result.turns[result.turns.length - 1]?.content).toBe(result.output);
    expect(result.output).toBe("final");
    // Arrival order preserved.
    expect(result.turns.map((t) => t.content)).toEqual(["draft1", "draft2", "final"]);
    // Every entry: non-empty hash, assistant role.
    for (const t of result.turns) {
      expect(t.role).toBe("assistant");
      expect(t.hash).not.toBe("");
      expect(t.hash).not.toBeNull();
    }
    // Additive: prior fields retain meaning.
    expect(result.sessionId).toBe("ses_fresh");
    expect(result.reused).toBe(false);
    expect(result.assistantTurnCount).toBe(3);
    expect(result.done.turnCount).toBe(4);
  });

  test("the same data is delivered by onTurn and by SendResult.turns", async () => {
    wireStream(fetchStub, [
      turnFrame(1, 0, "assistant", "one", "h1"),
      turnFrame(2, 1, "assistant", "two", "h2"),
      doneFrame(3, 2),
    ]);

    const seen: BrokerTurn[] = [];
    const result = await broker.send({
      threadId: THREAD,
      role: "planner",
      prompt: "go",
      onTurn: (t) => {
        seen.push(t);
      },
    });

    expect(seen).toEqual([...result.turns]);
  });
});

describe("broker.send — Phase 1 onTurn=null backward compat (#397 Step 3)", () => {
  const fetchStub = installFetchStub();
  let dir: string;
  let store: SessionStore;
  let broker: Broker;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-null-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
    broker = createBroker({
      sessionStore: store,
      resolveRoute: constantRoute,
      clientFactory: null,
    });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("onTurn=null still yields last-assistant output, count, done, and populated turns", async () => {
    wireStream(fetchStub, [
      turnFrame(1, 0, "user", "u"),
      turnFrame(2, 1, "assistant", "draft", "hd"),
      turnFrame(3, 2, "assistant", "answer", "ha"),
      doneFrame(4, 3),
    ]);

    const result = await broker.send({
      threadId: THREAD,
      role: "planner",
      prompt: "go",
      onTurn: null,
    });

    expect(result.output).toBe("answer");
    expect(result.assistantTurnCount).toBe(2);
    expect(result.done.turnCount).toBe(3);
    // turns is still populated even with no callback.
    expect(result.turns.map((t) => t.content)).toEqual(["draft", "answer"]);
  });

  test("non-assistant (user/system) turns never fire onTurn — assistant-scoped", async () => {
    wireStream(fetchStub, [
      turnFrame(1, 0, "user", "u"),
      turnFrame(2, 1, "system", "s"),
      turnFrame(3, 2, "assistant", "only-assistant", "ha"),
      doneFrame(4, 3),
    ]);

    const spy = vi.fn();
    const result = await broker.send({
      threadId: THREAD,
      role: "planner",
      prompt: "go",
      onTurn: spy,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ role: "assistant", content: "only-assistant" }),
    );
    expect(result.turns).toHaveLength(1);
    expect(result.assistantTurnCount).toBe(1);
  });
});
