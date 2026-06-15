/**
 * Test helpers for stubbing `globalThis.fetch` with deterministic responses
 * (JSON + SSE streams) without spinning up a real socket.
 */

import { afterEach, beforeEach, vi } from "vitest";

export type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

export type FetchResponseSpec =
  | {
      kind: "json";
      status: number;
      body: unknown;
    }
  | {
      kind: "sse";
      status: number;
      frames: string[];
    }
  | {
      kind: "raw";
      status: number;
      bodyText: string;
      contentType: string;
    }
  | {
      kind: "throw";
      error: Error;
    };

type Handler = (call: FetchCall) => FetchResponseSpec;

/** Build a single SSE frame string (id + event + data + blank line). */
export function sseFrame(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function headersToRecord(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (init === undefined) return out;
  if (init instanceof Headers) {
    init.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(init)) {
    for (const [k, v] of init) {
      out[String(k).toLowerCase()] = String(v);
    }
    return out;
  }
  for (const [k, v] of Object.entries(init)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

function buildSseResponse(spec: { status: number; frames: string[] }): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of spec.frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: spec.status,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

function buildJsonResponse(spec: { status: number; body: unknown }): Response {
  const text = JSON.stringify(spec.body);
  return new Response(text, {
    status: spec.status,
    headers: { "Content-Type": "application/json" },
  });
}

function specToResponse(spec: FetchResponseSpec): Response {
  switch (spec.kind) {
    case "json":
      return buildJsonResponse(spec);
    case "sse":
      return buildSseResponse(spec);
    case "raw":
      return new Response(spec.bodyText, {
        status: spec.status,
        headers: { "Content-Type": spec.contentType },
      });
    case "throw":
      throw spec.error;
  }
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function resolveRequestBody(body: BodyInit | null): string {
  if (body === null) return "";
  if (typeof body === "string") return body;
  throw new Error("test fetch only handles string or null bodies");
}

/**
 * Install a fetch stub for the lifetime of the current test. Returns a
 * `calls` array (live — pushed on each fetch) and a setter to swap the
 * handler mid-test.
 */
export function installFetchStub(): {
  calls: FetchCall[];
  setHandler: (h: Handler) => void;
} {
  const calls: FetchCall[] = [];
  let handler: Handler = () => ({
    kind: "json",
    status: 500,
    body: { error: "no handler installed" },
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> => {
        const call: FetchCall = {
          url: resolveRequestUrl(input),
          method: init?.method ?? "GET",
          headers: headersToRecord(init?.headers),
          body: resolveRequestBody(init?.body ?? null),
        };
        calls.push(call);
        return specToResponse(handler(call));
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
  });

  return {
    calls,
    setHandler(h) {
      handler = h;
    },
  };
}
