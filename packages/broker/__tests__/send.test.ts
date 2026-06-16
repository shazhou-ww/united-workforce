/**
 * Tests for `broker.send()` — cache hit, cache miss, 404 fallback, and
 * non-404 propagation. The Sumeru client is faked so every code path is
 * deterministic; the session store is real (temp SQLite path).
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
  SumeruSessionNotFoundError,
} from "../src/index.js";

const THREAD_A = "06FCHRTFS6STQY3ET1355NXYS0";
const HOST_A = "http://127.0.0.1:7900";
const HAPPY_DONE = { turnCount: 2, tokens: { in: 10, out: 5 }, durationMs: 1500 } as const;

type CreateSessionCall = CreateSessionArgs & { host: string };
type SendMessageCall = SendMessageArgs & { host: string };

type FakeClientHooks = {
  createSession: (args: CreateSessionArgs) => Promise<string>;
  sendMessage: (args: SendMessageArgs) => Promise<SumeruSendOutcome>;
};

type ClientFactoryRecorder = {
  createSessionCalls: CreateSessionCall[];
  sendMessageCalls: SendMessageCall[];
  factory: (host: string) => SumeruClient;
};

function recorderFactory(hooks: (host: string) => FakeClientHooks): ClientFactoryRecorder {
  const createSessionCalls: CreateSessionCall[] = [];
  const sendMessageCalls: SendMessageCall[] = [];
  const factory = (host: string): SumeruClient => {
    const h = hooks(host);
    return Object.freeze({
      async createSession(args: CreateSessionArgs): Promise<string> {
        createSessionCalls.push({ host, ...args });
        return h.createSession(args);
      },
      async sendMessage(args: SendMessageArgs): Promise<SumeruSendOutcome> {
        sendMessageCalls.push({ host, ...args });
        return h.sendMessage(args);
      },
    });
  };
  return { createSessionCalls, sendMessageCalls, factory };
}

function happyOutcome(content: string): SumeruSendOutcome {
  return {
    output: content,
    assistantTurnCount: 1,
    assistantTurns: [
      {
        index: 1,
        role: "assistant",
        content,
        timestamp: "",
        toolCalls: null,
        tokens: null,
        hash: "h_happy",
      },
    ],
    done: HAPPY_DONE,
  };
}

function constantRoute(host: string, gateway: string, cwd: string | null = null): AgentRoute {
  return { host, gateway, cwd };
}

describe("broker.send — cache hit", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-send-hit-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("reuses cached session id, no createSession call, no upsert, returns reused: true", async () => {
    store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: HOST_A,
      gateway: "claude-code",
      sessionId: "ses_existing",
    });
    const before = store.getSession(THREAD_A, "planner");
    expect(before?.sessionId).toBe("ses_existing");

    const rec = recorderFactory(() => ({
      createSession: async () => {
        throw new Error("createSession should not be called on cache hit");
      },
      sendMessage: async () => happyOutcome("hello"),
    }));

    const broker = createBroker({
      sessionStore: store,
      // Should NOT be invoked at all on cache hit (cached host/gateway is authoritative).
      resolveRoute: () => {
        throw new Error("resolveRoute should not be called on cache hit");
      },
      clientFactory: rec.factory,
    });

    const result = await broker.send({
      threadId: THREAD_A,
      role: "planner",
      prompt: "next step",
      onTurn: null,
    });

    expect(result.output).toBe("hello");
    expect(result.sessionId).toBe("ses_existing");
    expect(result.reused).toBe(true);
    expect(rec.createSessionCalls).toEqual([]);
    expect(rec.sendMessageCalls).toEqual([
      {
        host: HOST_A,
        gateway: "claude-code",
        sessionId: "ses_existing",
        content: "next step",
      },
    ]);

    // No mutation of the existing row.
    const after = store.getSession(THREAD_A, "planner");
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.sessionId).toBe("ses_existing");
  });
});

describe("broker.send — cache miss (cold start)", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-send-miss-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("creates new session, upserts BEFORE sending, returns reused: false", async () => {
    let upsertSeenAtSendTime: string | null = null;
    const rec = recorderFactory(() => ({
      createSession: async () => "ses_fresh",
      sendMessage: async () => {
        // Capture the persisted state at the moment send is invoked — the
        // spec mandates the upsert happens BEFORE the message POST so a
        // crash mid-stream still leaves a reusable mapping.
        const row = store.getSession(THREAD_A, "reviewer");
        upsertSeenAtSendTime = row === null ? null : row.sessionId;
        return happyOutcome("review-output");
      },
    }));

    const broker = createBroker({
      sessionStore: store,
      resolveRoute: (role) => {
        expect(role).toBe("reviewer");
        return constantRoute(HOST_A, "hermes", "/tmp/work-xyz");
      },
      clientFactory: rec.factory,
    });

    const result = await broker.send({
      threadId: THREAD_A,
      role: "reviewer",
      prompt: "review this",
      onTurn: null,
    });

    expect(result.output).toBe("review-output");
    expect(result.sessionId).toBe("ses_fresh");
    expect(result.reused).toBe(false);
    expect(rec.createSessionCalls).toEqual([
      { host: HOST_A, gateway: "hermes", cwd: "/tmp/work-xyz" },
    ]);
    expect(rec.sendMessageCalls).toEqual([
      { host: HOST_A, gateway: "hermes", sessionId: "ses_fresh", content: "review this" },
    ]);

    // Write-before-stream invariant: the upsert was visible when sendMessage ran.
    expect(upsertSeenAtSendTime).toBe("ses_fresh");

    const final = store.getSession(THREAD_A, "reviewer");
    expect(final?.sessionId).toBe("ses_fresh");
    expect(final?.host).toBe(HOST_A);
    expect(final?.gateway).toBe("hermes");
  });

  test("createSession failure leaves the store empty and propagates the error", async () => {
    const rec = recorderFactory(() => ({
      createSession: async () => {
        throw new Error("upstream-broken");
      },
      sendMessage: async () => {
        throw new Error("sendMessage should not be reached");
      },
    }));

    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "hermes"),
      clientFactory: rec.factory,
    });

    await expect(
      broker.send({ threadId: THREAD_A, role: "reviewer", prompt: "x", onTurn: null }),
    ).rejects.toThrow(/upstream-broken/);

    expect(store.getSession(THREAD_A, "reviewer")).toBeNull();
    expect(rec.sendMessageCalls).toEqual([]);
  });
});

describe("broker.send — 404 session_not_found fallback", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-send-404-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("creates fresh session, upserts BEFORE retry, sends original prompt verbatim, returns reused: false", async () => {
    store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: HOST_A,
      gateway: "claude-code",
      sessionId: "ses_stale",
    });

    let upsertSeenAtRetryTime: string | null = null;
    let sendCalls = 0;
    const rec = recorderFactory(() => ({
      createSession: async () => "ses_new",
      sendMessage: async (args: SendMessageArgs) => {
        sendCalls += 1;
        if (args.sessionId === "ses_stale") {
          throw new SumeruSessionNotFoundError(args.gateway, args.sessionId);
        }
        const row = store.getSession(THREAD_A, "planner");
        upsertSeenAtRetryTime = row === null ? null : row.sessionId;
        return happyOutcome("retry-output");
      },
    }));

    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "claude-code"),
      clientFactory: rec.factory,
    });

    const result = await broker.send({
      threadId: THREAD_A,
      role: "planner",
      prompt: "do the thing",
      onTurn: null,
    });

    expect(result.output).toBe("retry-output");
    expect(result.sessionId).toBe("ses_new");
    expect(result.reused).toBe(false);
    expect(sendCalls).toBe(2);

    // Original prompt is sent verbatim on retry — no rewrap.
    expect(rec.sendMessageCalls.map((c) => c.content)).toEqual(["do the thing", "do the thing"]);
    expect(rec.sendMessageCalls.map((c) => c.sessionId)).toEqual(["ses_stale", "ses_new"]);

    expect(upsertSeenAtRetryTime).toBe("ses_new");
    const final = store.getSession(THREAD_A, "planner");
    expect(final?.sessionId).toBe("ses_new");
  });

  test("a SECOND 404 from the retried session propagates without a third attempt", async () => {
    store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: HOST_A,
      gateway: "claude-code",
      sessionId: "ses_stale",
    });

    let sendCount = 0;
    const rec = recorderFactory(() => ({
      createSession: async () => "ses_new",
      sendMessage: async (args: SendMessageArgs) => {
        sendCount += 1;
        throw new SumeruSessionNotFoundError(args.gateway, args.sessionId);
      },
    }));

    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "claude-code"),
      clientFactory: rec.factory,
    });

    await expect(
      broker.send({ threadId: THREAD_A, role: "planner", prompt: "x", onTurn: null }),
    ).rejects.toBeInstanceOf(SumeruSessionNotFoundError);
    expect(sendCount).toBe(2);
  });

  test("non-404 error from first send is NOT retried", async () => {
    store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: HOST_A,
      gateway: "claude-code",
      sessionId: "ses_stale",
    });

    const rec = recorderFactory(() => ({
      createSession: async () => {
        throw new Error("createSession should not be called on non-404 path");
      },
      sendMessage: async () => {
        throw new Error("sumeru message send failed (HTTP 500): server boom");
      },
    }));

    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "claude-code"),
      clientFactory: rec.factory,
    });

    await expect(
      broker.send({ threadId: THREAD_A, role: "planner", prompt: "x", onTurn: null }),
    ).rejects.toThrow(/HTTP 500/);

    // Stale row remains unchanged because no retry happened.
    expect(store.getSession(THREAD_A, "planner")?.sessionId).toBe("ses_stale");
    expect(rec.createSessionCalls).toEqual([]);
    expect(rec.sendMessageCalls).toHaveLength(1);
  });
});

describe("broker.send — output is raw (no frontmatter extraction)", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-send-raw-"));
    store = createSessionStore({ dbPath: join(dir, "sessions.db") });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("preserves the assistant content byte-for-byte even with frontmatter fences", async () => {
    const raw = "---\nstatus: done\nbranch: feat/x\n---\n\nbody body body\n  with weird   spaces\n";

    const rec = recorderFactory(() => ({
      createSession: async () => "ses_raw",
      sendMessage: async () => ({
        output: raw,
        assistantTurnCount: 1,
        assistantTurns: [
          {
            index: 1,
            role: "assistant",
            content: raw,
            timestamp: "",
            toolCalls: null,
            tokens: null,
            hash: "h_raw",
          },
        ],
        done: HAPPY_DONE,
      }),
    }));

    const broker = createBroker({
      sessionStore: store,
      resolveRoute: () => constantRoute(HOST_A, "claude-code"),
      clientFactory: rec.factory,
    });

    const result = await broker.send({
      threadId: THREAD_A,
      role: "planner",
      prompt: "produce frontmatter",
      onTurn: null,
    });

    // Verbatim — broker does NOT trim, parse, or validate frontmatter.
    expect(result.output).toBe(raw);
  });
});
