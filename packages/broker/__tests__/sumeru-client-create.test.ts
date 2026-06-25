/**
 * Tests for `createSumeruClient` — host normalisation, no I/O at construction,
 * and the shape of the returned object.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createSumeruClient,
  DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS,
} from "../src/sumeru-client/index.js";

describe("createSumeruClient", () => {
  test("returns an object with createSession + sendMessage methods", () => {
    const client = createSumeruClient("http://127.0.0.1:7900");
    expect(typeof client.createSession).toBe("function");
    expect(typeof client.sendMessage).toBe("function");
  });

  test("returned object is frozen", () => {
    const client = createSumeruClient("http://127.0.0.1:7900");
    expect(Object.isFrozen(client)).toBe(true);
  });

  test("does not perform I/O at construction time (no fetch invoked)", () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => {
      calls += 1;
      return Promise.reject(new Error("fetch should not be called"));
    };
    try {
      createSumeruClient("http://127.0.0.1:7900");
      createSumeruClient("http://localhost:7900/");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toBe(0);
  });

  test("constructs without throwing for valid host strings (with or without trailing slash)", () => {
    expect(() => createSumeruClient("http://127.0.0.1:7900")).not.toThrow();
    expect(() => createSumeruClient("http://127.0.0.1:7900/")).not.toThrow();
    expect(() => createSumeruClient("http://127.0.0.1:7900///")).not.toThrow();
  });

  test("accepts an optional options bag without throwing", () => {
    expect(() => createSumeruClient("http://127.0.0.1:7900", {} as never)).not.toThrow();
    expect(() =>
      createSumeruClient("http://127.0.0.1:7900", {
        sseHeartbeatTimeoutMs: 30_000,
      }),
    ).not.toThrow();
    expect(() =>
      createSumeruClient("http://127.0.0.1:7900", {
        sseHeartbeatTimeoutMs: null,
      }),
    ).not.toThrow();
  });

  test("default constants are exported with the documented values", () => {
    expect(DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS).toBe(45_000);
  });
});

describe("createSumeruClient — default SSE timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Build an SSE Response whose body never enqueues bytes and never closes —
   * `consumeSse` will hang forever in the absence of timers.
   */
  function buildHungSseResponse(): Response {
    const stream = new ReadableStream<Uint8Array>({
      // controller never enqueues, never closes.
      start: () => undefined,
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
  }

  test("createSumeruClient applies default SSE timeouts when options are omitted", async () => {
    vi.stubGlobal("fetch", async () => buildHungSseResponse());
    const client = createSumeruClient("http://127.0.0.1:7900");
    const promise = client.sendMessage({ gateway: "g", sessionId: "s", content: "x" });
    // Avoid an unhandled rejection if it rejects before we attach the
    // expectation — the watchdog default (45_000ms) fires first.
    promise.catch(() => undefined);

    // Below the watchdog default — must not reject yet.
    await vi.advanceTimersByTimeAsync(DEFAULT_SSE_HEARTBEAT_TIMEOUT_MS - 1);
    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // Flush microtasks so any premature rejection would surface.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    // Crossing the watchdog default (45_000ms) MUST trigger a rejection
    // because the stream emitted no events.
    await vi.advanceTimersByTimeAsync(2);
    await expect(promise).rejects.toThrow(
      /sumeru SSE stream watchdog: no event received within 45000ms/,
    );
  });
});
