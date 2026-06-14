import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootstrap, createMemoryStore } from "@ocas/core";
import type { ThreadId } from "@united-workforce/protocol";
import { setCachedSessionId } from "@united-workforce/util-agent";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createSumeruSession, sendSumeruMessage } from "../src/http.js";

type RequestRecord = {
  method: string;
  url: string;
  body: string;
};

type Route = {
  match: (req: RequestRecord) => boolean;
  respond: () => { status: number; sse?: string[]; json?: unknown };
};

async function startRoutedServer(routes: Route[]): Promise<{
  url: string;
  server: Server;
  requests: RequestRecord[];
}> {
  const requests: RequestRecord[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => {
      chunks.push(c);
    });
    req.on("end", () => {
      const record: RequestRecord = {
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(record);
      dispatchRoutes(res, record, routes);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    server,
    requests,
  };
}

type MockRes = {
  statusCode: number;
  setHeader: (k: string, v: string) => void;
  write: (s: string) => boolean;
  end: (body?: string) => void;
};

function dispatchRoutes(res: MockRes, record: RequestRecord, routes: Route[]): void {
  for (const route of routes) {
    if (route.match(record)) {
      writeRouteResponse(res, route.respond());
      return;
    }
  }
  res.statusCode = 500;
  res.end("no route matched");
}

function writeRouteResponse(
  res: MockRes,
  result: { status: number; sse?: string[]; json?: unknown },
): void {
  res.statusCode = result.status;
  if (result.sse !== undefined) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    for (const f of result.sse) res.write(f);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(result.json ?? {}));
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function sseFrame(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function assistantTurn(id: number, content: string): string {
  return sseFrame(id, "turn", {
    type: "@sumeru/turn",
    value: {
      index: id,
      role: "assistant",
      content,
      timestamp: "",
      toolCalls: null,
    },
  });
}

function doneFrame(id: number): string {
  return sseFrame(id, "done", {
    type: "@sumeru/summary",
    value: { turnCount: 1, tokens: { in: 1, out: 1 }, durationMs: 100 },
  });
}

/**
 * End-to-end test of the (session-create → send-message) branch using only
 * the lower-level `createSumeruSession` + `sendSumeruMessage` primitives, so
 * the suite stays free of the bigger `createAgent` fixture harness. The
 * higher-level `runSumeru` flow is covered indirectly by these primitives +
 * the session-cache + buildSumeruPrompt tests in `sumeru.test.ts`.
 */
describe("session-create + send-message branches", () => {
  let url: string;
  let server: Server;
  let requests: RequestRecord[];
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "sumeru-int-"));
  });

  afterEach(async () => {
    if (server !== undefined) await stopServer(server);
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("branch A: cache miss → POST /sessions then POST /messages, cache populated", async () => {
    ({ url, server, requests } = await startRoutedServer([
      {
        match: (r) => r.method === "POST" && r.url === "/gateways/claude-code/sessions",
        respond: () => ({
          status: 201,
          json: {
            type: "@sumeru/session",
            value: {
              id: "ses_branchA",
              gateway: "claude-code",
              status: "idle",
              createdAt: "",
              config: {},
            },
          },
        }),
      },
      {
        match: (r) =>
          r.method === "POST" && r.url === "/gateways/claude-code/sessions/ses_branchA/messages",
        respond: () => ({
          status: 200,
          sse: [assistantTurn(1, "ack"), doneFrame(2)],
        }),
      },
    ]));

    const sessionId = await createSumeruSession({
      instanceUrl: url,
      gateway: "claude-code",
    });
    expect(sessionId).toBe("ses_branchA");
    await setCachedSessionId("sumeru", "01TINTEG" as ThreadId, "developer", sessionId, storageRoot);

    const outcome = await sendSumeruMessage({
      instanceUrl: url,
      gateway: "claude-code",
      sessionId,
      content: "hello",
    });
    expect(outcome.output).toBe("ack");

    const sessionsPosts = requests.filter((r) => r.url === "/gateways/claude-code/sessions");
    const messagePosts = requests.filter((r) => r.url.endsWith("/messages"));
    expect(sessionsPosts).toHaveLength(1);
    expect(messagePosts).toHaveLength(1);
    expect(messagePosts[0].body).toBe(JSON.stringify({ content: "hello" }));
  });

  test("branch B: cache hit → skip POST /sessions, only POST /messages", async () => {
    ({ url, server, requests } = await startRoutedServer([
      {
        match: (r) =>
          r.method === "POST" && r.url === "/gateways/claude-code/sessions/ses_cached/messages",
        respond: () => ({
          status: 200,
          sse: [assistantTurn(1, "cached-output"), doneFrame(2)],
        }),
      },
    ]));

    const outcome = await sendSumeruMessage({
      instanceUrl: url,
      gateway: "claude-code",
      sessionId: "ses_cached",
      content: "continue",
    });
    expect(outcome.output).toBe("cached-output");

    expect(requests.filter((r) => r.url === "/gateways/claude-code/sessions")).toHaveLength(0);
    expect(requests.filter((r) => r.url.endsWith("/messages"))).toHaveLength(1);
  });

  test("continue() uses the SAME sessionId — no new POST /sessions", async () => {
    ({ url, server, requests } = await startRoutedServer([
      {
        match: (r) => r.method === "POST" && r.url === "/gateways/g/sessions/ses_abc/messages",
        respond: () => ({
          status: 200,
          sse: [assistantTurn(1, "fixed"), doneFrame(2)],
        }),
      },
    ]));

    const outcome = await sendSumeruMessage({
      instanceUrl: url,
      gateway: "g",
      sessionId: "ses_abc",
      content: "please fix the frontmatter",
    });

    expect(outcome.output).toBe("fixed");
    const sessionsPosts = requests.filter((r) => r.url === "/gateways/g/sessions");
    expect(sessionsPosts).toHaveLength(0);
    const messagePosts = requests.filter((r) => r.url.endsWith("/messages"));
    expect(messagePosts).toHaveLength(1);
    expect(JSON.parse(messagePosts[0].body)).toEqual({
      content: "please fix the frontmatter",
    });
  });
});

// ─── @uwf/text detail storage smoke test ────────────────────

describe("detail node storage", () => {
  test("storeSseDetail writes an @uwf/text node and returns its hash", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const { storeSseDetail } = await import("../src/sumeru.js");
    const hash = await storeSseDetail(store, "ses_xyz", {
      output: "ignored",
      assistantTurnCount: 2,
      done: { turnCount: 2, tokens: { in: 7, out: 9 }, durationMs: 4321 },
    });
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    const node = store.cas.get(hash as never);
    expect(node).not.toBeNull();
    const payload = (node as { payload: string }).payload;
    expect(payload).toContain("sumeru session ses_xyz");
    expect(payload).toContain("2 assistant turns");
    expect(payload).toContain("16 tokens");
    expect(payload).toContain("duration 4s");
  });
});
