/**
 * Tests for `client.sendMessage` — POST URL/headers/body, SSE stream
 * consumption, last-assistant-turn extraction, error handling, and the
 * 404 typed error.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createSumeruClient, SumeruSessionNotFoundError } from "../src/sumeru-client/index.js";
import { installFetchStub, sseFrame } from "./fetch-stub.js";

type RequestRecord = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

function buildRequestRecord(
  req: {
    method: string | undefined;
    url: string | undefined;
    headers: NodeJS.Dict<string | string[]>;
  },
  chunks: Buffer[],
): RequestRecord {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
  }
  return {
    method: req.method ?? "",
    url: req.url ?? "",
    headers,
    body: Buffer.concat(chunks).toString("utf8"),
  };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("client.sendMessage — happy path", () => {
  const fetchStub = installFetchStub();

  test("POSTs URL+headers+body and returns last assistant turn content", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 0,
            role: "user",
            content: "ping",
            timestamp: "2026-01-01T00:00:00Z",
            toolCalls: null,
          },
        }),
        sseFrame(2, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 1,
            role: "assistant",
            content: "pong",
            timestamp: "2026-01-01T00:00:01Z",
            toolCalls: null,
          },
        }),
        sseFrame(3, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 2, tokens: { in: 10, out: 5 }, durationMs: 1500 },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const outcome = await client.sendMessage({
      gateway: "claude-code",
      sessionId: "ses_abc",
      content: "say hi",
    });

    expect(outcome.output).toBe("pong");
    expect(outcome.assistantTurnCount).toBe(1);
    expect(outcome.done.turnCount).toBe(2);
    expect(outcome.done.tokens).toEqual({ in: 10, out: 5 });
    expect(outcome.done.durationMs).toBe(1500);

    expect(fetchStub.calls).toHaveLength(1);
    expect(fetchStub.calls[0].method).toBe("POST");
    expect(fetchStub.calls[0].url).toBe(
      "http://127.0.0.1:7900/gateways/claude-code/sessions/ses_abc/messages",
    );
    expect(fetchStub.calls[0].headers["content-type"]).toBe("application/json");
    expect(fetchStub.calls[0].headers.accept).toBe("text/event-stream");
    expect(JSON.parse(fetchStub.calls[0].body)).toEqual({ content: "say hi" });
  });

  test("returns LAST assistant turn when multiple are present (intermediate discarded)", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "user", content: "go", timestamp: "", toolCalls: null },
        }),
        sseFrame(2, "turn", {
          type: "@sumeru/turn",
          value: { index: 1, role: "assistant", content: "draft1", timestamp: "", toolCalls: null },
        }),
        sseFrame(3, "turn", {
          type: "@sumeru/turn",
          value: { index: 2, role: "assistant", content: "draft2", timestamp: "", toolCalls: null },
        }),
        sseFrame(4, "turn", {
          type: "@sumeru/turn",
          value: { index: 3, role: "assistant", content: "final", timestamp: "", toolCalls: null },
        }),
        sseFrame(5, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 4, tokens: null, durationMs: 1 },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const outcome = await client.sendMessage({
      gateway: "g",
      sessionId: "s",
      content: "x",
    });
    expect(outcome.output).toBe("final");
    expect(outcome.assistantTurnCount).toBe(3);
  });

  test("ignores heartbeat frames", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "heartbeat", { type: "@sumeru/heartbeat", value: { elapsed: 100 } }),
        sseFrame(2, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "assistant", content: "hi", timestamp: "", toolCalls: null },
        }),
        sseFrame(3, "heartbeat", { type: "@sumeru/heartbeat", value: { elapsed: 200 } }),
        sseFrame(4, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 1, tokens: null, durationMs: 1 },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const outcome = await client.sendMessage({
      gateway: "g",
      sessionId: "s",
      content: "x",
    });
    expect(outcome.output).toBe("hi");
  });
});

describe("client.sendMessage — error paths", () => {
  const fetchStub = installFetchStub();

  test("error event in SSE rejects with `sumeru <code>: <message>`", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "error", {
          type: "@sumeru/error",
          value: { error: "adapter_error", message: "boom" },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/adapter_error.*boom/);
  });

  test("premature close (no done, no error) rejects with turn count in message", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "assistant", content: "stuff", timestamp: "", toolCalls: null },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/1 turn events without done or error/);
  });

  test("no assistant turns at all rejects", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "user", content: "u", timestamp: "", toolCalls: null },
        }),
        sseFrame(2, "turn", {
          type: "@sumeru/turn",
          value: { index: 1, role: "system", content: "s", timestamp: "", toolCalls: null },
        }),
        sseFrame(3, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 2, tokens: null, durationMs: 1 },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/no assistant turns/);
  });

  test("404 session_not_found rejects with SumeruSessionNotFoundError carrying canonical code", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 404,
      body: {
        type: "@sumeru/error",
        value: { error: "session_not_found", message: "no such session" },
      },
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const promise = client.sendMessage({
      gateway: "g",
      sessionId: "ses_stale",
      content: "x",
    });
    await expect(promise).rejects.toBeInstanceOf(SumeruSessionNotFoundError);
    await promise.catch((err: unknown) => {
      const e = err as SumeruSessionNotFoundError;
      expect(e.code).toBe("sumeru_session_not_found");
      expect(e.gateway).toBe("g");
      expect(e.sessionId).toBe("ses_stale");
    });
  });

  test("404 with non-session_not_found code propagates as plain Error", async () => {
    fetchStub.setHandler(() => ({
      kind: "json",
      status: 404,
      body: {
        type: "@sumeru/error",
        value: { error: "gateway_not_found", message: "no" },
      },
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    const promise = client.sendMessage({
      gateway: "g",
      sessionId: "s",
      content: "x",
    });
    await expect(promise).rejects.not.toBeInstanceOf(SumeruSessionNotFoundError);
    await expect(promise).rejects.toThrow(/HTTP 404 gateway_not_found/);
  });

  test("500 with no body propagates as plain Error including session id", async () => {
    fetchStub.setHandler(() => ({
      kind: "raw",
      status: 500,
      bodyText: "",
      contentType: "text/plain",
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "ses_x", content: "x" }),
    ).rejects.toThrow(/HTTP 500.*session=ses_x/);
  });

  test("malformed JSON in turn frame rejects with first 200 chars", async () => {
    const badFrame = "id: 1\nevent: turn\ndata: this-is-not-json\n\n";
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [badFrame],
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/turn event has malformed JSON/);
  });

  test("turn frame missing role rejects with the dedicated error", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, content: "no role here", timestamp: "", toolCalls: null },
        }),
      ],
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/missing role or content/);
  });
});

describe("client.sendMessage — host normalisation", () => {
  const fetchStub = installFetchStub();

  test("normalises trailing slash on host", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "assistant", content: "ok", timestamp: "", toolCalls: null },
        }),
        sseFrame(2, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 1, tokens: null, durationMs: 1 },
        }),
      ],
    }));
    const client = createSumeruClient("http://127.0.0.1:7900/");
    await client.sendMessage({ gateway: "g", sessionId: "s", content: "x" });
    expect(fetchStub.calls[0].url).toBe("http://127.0.0.1:7900/gateways/g/sessions/s/messages");
  });
});

describe("client.sendMessage — SSE watchdog (issue #391)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Build an SSE Response whose body is fully driven by the test — the
   * caller receives the underlying `ReadableStreamDefaultController` and may
   * enqueue (or refuse to enqueue) bytes whenever convenient.
   */
  function buildControllableSseResponse(): {
    response: Response;
    controller: ReadableStreamDefaultController<Uint8Array>;
  } {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controllerRef = c;
      },
    });
    if (controllerRef === null) {
      throw new Error("ReadableStream controller never wired");
    }
    return {
      response: new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
      controller: controllerRef,
    };
  }

  test("sendMessage rejects when watchdog fires and reconnect fails", async () => {
    const built = buildControllableSseResponse();
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return built.response;
      // Reconnect after watchdog — fail fast so sendMessage finalizes.
      return new Response("", { status: 404 });
    });
    const encoder = new TextEncoder();

    const client = createSumeruClient("http://127.0.0.1:7900", {
      sseHeartbeatTimeoutMs: 50,
    });
    const promise = client.sendMessage({
      gateway: "claude-code",
      sessionId: "ses_abc",
      content: "hello",
    });
    promise.catch(() => undefined);

    // Send one turn frame so the watchdog has something to "reset" against.
    built.controller.enqueue(
      encoder.encode(
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "user", content: "u", timestamp: "", toolCalls: null },
        }),
      ),
    );
    // Let microtasks settle so the reader consumes the frame & resets watchdog.
    await Promise.resolve();
    await Promise.resolve();
    // Now go silent past the watchdog window — reconnect fails, finalize throws.
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).rejects.toThrow(/1 turn events without done or error/);
  });

  test("heartbeat events reset the watchdog and allow long-running streams", async () => {
    const built = buildControllableSseResponse();
    vi.stubGlobal("fetch", async () => built.response);
    const encoder = new TextEncoder();

    const client = createSumeruClient("http://127.0.0.1:7900", {
      sseHeartbeatTimeoutMs: 50,
    });
    const promise = client.sendMessage({
      gateway: "g",
      sessionId: "s",
      content: "x",
    });

    // Emit a heartbeat every 30ms for ~210ms — each one resets the 50ms
    // watchdog. Then emit assistant turn + done.
    for (let i = 0; i < 7; i += 1) {
      await vi.advanceTimersByTimeAsync(30);
      built.controller.enqueue(
        encoder.encode(
          sseFrame(i + 1, "heartbeat", { type: "@sumeru/heartbeat", value: { elapsed: 30 } }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    }
    built.controller.enqueue(
      encoder.encode(
        sseFrame(100, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 1,
            role: "assistant",
            content: "ok",
            timestamp: "",
            toolCalls: null,
          },
        }),
      ),
    );
    built.controller.enqueue(
      encoder.encode(
        sseFrame(101, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 1, tokens: null, durationMs: 1 },
        }),
      ),
    );
    built.controller.close();
    await Promise.resolve();
    await Promise.resolve();

    await expect(promise).resolves.toMatchObject({ output: "ok" });
  });
});

describe("client.sendMessage — SSE reconnect (issue #446)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await stopServer(server);
      server = undefined;
    }
  });

  test("sendMessage reconnects with Last-Event-ID on watchdog timeout and merges turns", async () => {
    let requestCount = 0;
    const requests: RequestRecord[] = [];

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => {
        chunks.push(c);
      });
      req.on("end", () => {
        const record = buildRequestRecord(req, chunks);
        requests.push(record);
        requestCount += 1;

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");

        if (requestCount === 1) {
          res.write(
            sseFrame(1, "turn", {
              type: "@sumeru/turn",
              value: {
                index: 0,
                role: "assistant",
                content: "first",
                timestamp: "",
                toolCalls: null,
              },
            }),
          );
          return;
        }

        res.write(
          sseFrame(2, "turn", {
            type: "@sumeru/turn",
            value: {
              index: 1,
              role: "assistant",
              content: "second",
              timestamp: "",
              toolCalls: null,
            },
          }),
        );
        res.write(
          sseFrame(3, "done", {
            type: "@sumeru/summary",
            value: { turnCount: 2, tokens: { in: 5, out: 3 }, durationMs: 500 },
          }),
        );
        res.end();
      });
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server!.address() as AddressInfo).port;

    const client = createSumeruClient(`http://127.0.0.1:${port}`, {
      sseHeartbeatTimeoutMs: 50,
    });

    const outcome = await client.sendMessage({
      gateway: "claude-code",
      sessionId: "ses_abc",
      content: "hello",
    });

    expect(outcome.kind).toBe("completed");
    expect(outcome.assistantTurnCount).toBe(2);
    expect(outcome.output).toBe("second");
    expect(outcome.done).toEqual({
      turnCount: 2,
      tokens: { in: 5, out: 3 },
      durationMs: 500,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].body).toBe(JSON.stringify({ content: "hello" }));
    expect(requests[1].body).toBe("");
    expect(requests[1].headers["last-event-id"]).toBe("1");
  }, 10_000);
});
