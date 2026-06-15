import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SessionStore } from "../src/session-store/index.js";
import { createSessionStore } from "../src/session-store/index.js";

const THREAD_A = "06FCHRTFS6STQY3ET1355NXYS0";
const THREAD_B = "06FCHRTFS6STQY3ET1355NXYS1";

describe("createSessionStore", () => {
  let dir: string;
  let dbPath: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "broker-"));
    dbPath = join(dir, "sessions.db");
    store = createSessionStore({ dbPath });
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("getSession returns null on a fresh DB", () => {
    expect(store.getSession(THREAD_A, "planner")).toBeNull();
  });

  test("upsertSession then getSession returns the same record", () => {
    const inserted = store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: "http://127.0.0.1:7900",
      gateway: "claude-code",
      sessionId: "ses_abc",
    });

    expect(inserted.threadId).toBe(THREAD_A);
    expect(inserted.role).toBe("planner");
    expect(inserted.host).toBe("http://127.0.0.1:7900");
    expect(inserted.gateway).toBe("claude-code");
    expect(inserted.sessionId).toBe("ses_abc");
    expect(typeof inserted.createdAt).toBe("number");
    expect(inserted.createdAt).toBeGreaterThan(0);

    const fetched = store.getSession(THREAD_A, "planner");
    expect(fetched).toEqual(inserted);
  });

  test("upsertSession on the same key updates fields but preserves createdAt", async () => {
    const first = store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: "http://127.0.0.1:7900",
      gateway: "claude-code",
      sessionId: "ses_v1",
    });

    // Make sure Date.now() advances at least 2ms before the conflict update
    // so that an accidental overwrite of createdAt would be detectable.
    await new Promise<void>((resolve) => setTimeout(resolve, 2));

    const second = store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: "http://127.0.0.1:7901",
      gateway: "hermes",
      sessionId: "ses_v2",
    });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.host).toBe("http://127.0.0.1:7901");
    expect(second.gateway).toBe("hermes");
    expect(second.sessionId).toBe("ses_v2");

    const fetched = store.getSession(THREAD_A, "planner");
    expect(fetched).toEqual(second);
  });

  test("listByThread returns rows in role ASC order", () => {
    store.upsertSession({
      threadId: THREAD_A,
      role: "solver",
      host: "h",
      gateway: "g",
      sessionId: "s1",
    });
    store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: "h",
      gateway: "g",
      sessionId: "s2",
    });
    store.upsertSession({
      threadId: THREAD_A,
      role: "tester",
      host: "h",
      gateway: "g",
      sessionId: "s3",
    });

    const rows = store.listByThread(THREAD_A);
    expect(rows.map((r) => r.role)).toEqual(["planner", "solver", "tester"]);
  });

  test("listByThread returns [] when no rows match", () => {
    expect(store.listByThread(THREAD_A)).toEqual([]);
  });

  test("deleteByThread returns count and removes rows for that thread only", () => {
    for (const role of ["planner", "solver", "tester"]) {
      store.upsertSession({
        threadId: THREAD_A,
        role,
        host: "h",
        gateway: "g",
        sessionId: `s-${role}`,
      });
    }
    store.upsertSession({
      threadId: THREAD_B,
      role: "planner",
      host: "h",
      gateway: "g",
      sessionId: "s-other",
    });

    const deleted = store.deleteByThread(THREAD_A);
    expect(deleted).toBe(3);
    expect(store.listByThread(THREAD_A)).toEqual([]);
    expect(store.getSession(THREAD_A, "planner")).toBeNull();
    expect(store.getSession(THREAD_A, "solver")).toBeNull();
    expect(store.getSession(THREAD_A, "tester")).toBeNull();

    // Other thread's row is untouched.
    const otherRow = store.getSession(THREAD_B, "planner");
    expect(otherRow).not.toBeNull();
    expect(otherRow?.sessionId).toBe("s-other");

    // Second call returns 0.
    expect(store.deleteByThread(THREAD_A)).toBe(0);
  });

  test("rows are independent across (threadId, role) keys", () => {
    store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: "h-a-p",
      gateway: "g",
      sessionId: "s-a-p",
    });
    store.upsertSession({
      threadId: THREAD_A,
      role: "solver",
      host: "h-a-s",
      gateway: "g",
      sessionId: "s-a-s",
    });
    store.upsertSession({
      threadId: THREAD_B,
      role: "planner",
      host: "h-b-p",
      gateway: "g",
      sessionId: "s-b-p",
    });

    expect(store.getSession(THREAD_A, "planner")?.sessionId).toBe("s-a-p");
    expect(store.getSession(THREAD_A, "solver")?.sessionId).toBe("s-a-s");
    expect(store.getSession(THREAD_B, "planner")?.sessionId).toBe("s-b-p");

    // Updating one does not touch the others.
    store.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: "h-a-p2",
      gateway: "g",
      sessionId: "s-a-p2",
    });
    expect(store.getSession(THREAD_A, "planner")?.sessionId).toBe("s-a-p2");
    expect(store.getSession(THREAD_A, "solver")?.sessionId).toBe("s-a-s");
    expect(store.getSession(THREAD_B, "planner")?.sessionId).toBe("s-b-p");
  });

  test("close is idempotent", () => {
    expect(() => {
      store.close();
      store.close();
    }).not.toThrow();
  });
});

describe("createSessionStore — persistence across reopen", () => {
  test("schema migration is idempotent and rows survive close-and-reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-"));
    const dbPath = join(dir, "sessions.db");

    const first = createSessionStore({ dbPath });
    const inserted = first.upsertSession({
      threadId: THREAD_A,
      role: "planner",
      host: "http://127.0.0.1:7900",
      gateway: "claude-code",
      sessionId: "ses_persist",
    });
    first.close();

    const second = createSessionStore({ dbPath });
    try {
      const fetched = second.getSession(THREAD_A, "planner");
      expect(fetched).toEqual(inserted);
    } finally {
      second.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
