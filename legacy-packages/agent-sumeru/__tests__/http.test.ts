import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";

import { createSumeruSession, SumeruSessionNotFoundError, sendSumeruMessage } from "../src/http.js";

type RequestRecord = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

type Handler = (req: RequestRecord) => {
  status: number;
  body: string;
  contentType: string;
  sseFrames?: string[];
};

async function startMockServer(handler: Handler): Promise<{
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
      const record = buildRequestRecord(req, chunks);
      requests.push(record);
      const result = handler(record);
      writeMockResponse(res, result);
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

function writeMockResponse(
  res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    write: (s: string) => boolean;
    end: (body?: string) => void;
  },
  result: ReturnType<Handler>,
): void {
  res.statusCode = result.status;
  if (result.sseFrames !== undefined) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    for (const frame of result.sseFrames) {
      res.write(frame);
    }
    res.end();
    return;
  }
  res.setHeader("Content-Type", result.contentType);
  res.end(result.body);
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("createSumeruSession", () => {
  let url: string;
  let server: Server;
  let requests: RequestRecord[];

  afterEach(async () => {
    if (server !== undefined) await stopServer(server);
  });

  test("POST /gateways/<gw>/sessions returns session id on 201", async () => {
    ({ url, server, requests } = await startMockServer(() => ({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        type: "@sumeru/session",
        value: {
          id: "ses_test1",
          gateway: "claude-code",
          status: "idle",
          createdAt: "2026-01-01T00:00:00Z",
          config: {},
        },
      }),
    })));
    const sessionId = await createSumeruSession({
      instanceUrl: url,
      gateway: "claude-code",
    });
    expect(sessionId).toBe("ses_test1");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe("/gateways/claude-code/sessions");
    expect(requests[0].body).toBe("{}");
    expect(requests[0].headers["content-type"]).toBe("application/json");
  });

  test("404 gateway_not_found surfaces error code in message", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        type: "@sumeru/error",
        value: { error: "gateway_not_found", message: "no such gateway" },
      }),
    })));
    await expect(createSumeruSession({ instanceUrl: url, gateway: "claude-code" })).rejects.toThrow(
      /gateway_not_found.*claude-code/,
    );
  });

  test("503 adapter_unavailable surfaces error code", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        type: "@sumeru/error",
        value: { error: "adapter_unavailable", message: "no adapter" },
      }),
    })));
    await expect(createSumeruSession({ instanceUrl: url, gateway: "claude-code" })).rejects.toThrow(
      /adapter_unavailable/,
    );
  });

  test("malformed body (no @sumeru/session envelope) throws", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "ses_no_envelope" }),
    })));
    await expect(createSumeruSession({ instanceUrl: url, gateway: "claude-code" })).rejects.toThrow(
      /unexpected body/,
    );
  });
});

function sseFrame(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("sendSumeruMessage", () => {
  let url: string;
  let server: Server;
  let requests: RequestRecord[];

  afterEach(async () => {
    if (server !== undefined) await stopServer(server);
  });

  test("returns last assistant turn's content as output", async () => {
    ({ url, server, requests } = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: "",
      sseFrames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 0,
            role: "user",
            content: "hi",
            timestamp: "2026-01-01T00:00:00Z",
            toolCalls: null,
          },
        }),
        sseFrame(2, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 1,
            role: "assistant",
            content: "hello back",
            timestamp: "2026-01-01T00:00:01Z",
            toolCalls: null,
          },
        }),
        sseFrame(3, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 2, tokens: { in: 10, out: 5 }, durationMs: 1500 },
        }),
      ],
    })));
    const outcome = await sendSumeruMessage({
      instanceUrl: url,
      gateway: "claude-code",
      sessionId: "ses_abc",
      content: "say hi",
    });
    expect(outcome.output).toBe("hello back");
    expect(outcome.assistantTurnCount).toBe(1);
    expect(outcome.done.turnCount).toBe(2);
    expect(outcome.done.tokens).toEqual({ in: 10, out: 5 });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe("/gateways/claude-code/sessions/ses_abc/messages");
    expect(requests[0].headers.accept).toBe("text/event-stream");
    expect(JSON.parse(requests[0].body)).toEqual({ content: "say hi" });
  });

  test("returns LAST assistant turn when multiple are present", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: "",
      sseFrames: [
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
        sseFrame(2, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 1,
            role: "assistant",
            content: "middle",
            timestamp: "",
            toolCalls: null,
          },
        }),
        sseFrame(3, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 2,
            role: "assistant",
            content: "last",
            timestamp: "",
            toolCalls: null,
          },
        }),
        sseFrame(4, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 3, tokens: null, durationMs: 1 },
        }),
      ],
    })));
    const outcome = await sendSumeruMessage({
      instanceUrl: url,
      gateway: "g",
      sessionId: "s",
      content: "x",
    });
    expect(outcome.output).toBe("last");
    expect(outcome.assistantTurnCount).toBe(3);
  });

  test("ignores heartbeat events", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: "",
      sseFrames: [
        sseFrame(1, "heartbeat", { type: "@sumeru/heartbeat", value: { elapsed: 100 } }),
        sseFrame(2, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 0,
            role: "assistant",
            content: "only-content",
            timestamp: "",
            toolCalls: null,
          },
        }),
        sseFrame(3, "heartbeat", { type: "@sumeru/heartbeat", value: { elapsed: 200 } }),
        sseFrame(4, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 1, tokens: null, durationMs: 1 },
        }),
      ],
    })));
    const outcome = await sendSumeruMessage({
      instanceUrl: url,
      gateway: "g",
      sessionId: "s",
      content: "x",
    });
    expect(outcome.output).toBe("only-content");
  });

  test("error event throws Error containing code + message", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: "",
      sseFrames: [
        sseFrame(1, "error", {
          type: "@sumeru/error",
          value: { error: "adapter_error", message: "boom" },
        }),
      ],
    })));
    await expect(
      sendSumeruMessage({ instanceUrl: url, gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/adapter_error.*boom/);
  });

  test("premature close (no done) throws", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: "",
      sseFrames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 0,
            role: "assistant",
            content: "stuff",
            timestamp: "",
            toolCalls: null,
          },
        }),
      ],
    })));
    await expect(
      sendSumeruMessage({ instanceUrl: url, gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/without done or error/);
  });

  test("404 session_not_found throws SumeruSessionNotFoundError", async () => {
    ({ url, server } = await startMockServer(() => ({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        type: "@sumeru/error",
        value: { error: "session_not_found", message: "no such session" },
      }),
    })));
    const promise = sendSumeruMessage({
      instanceUrl: url,
      gateway: "g",
      sessionId: "ses_stale",
      content: "x",
    });
    await expect(promise).rejects.toThrow(SumeruSessionNotFoundError);
    await promise.catch((err) => {
      expect((err as SumeruSessionNotFoundError).code).toBe("sumeru_session_not_found");
    });
  });
});
