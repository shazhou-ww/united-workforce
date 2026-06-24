/**
 * Tests for `client.sendMessage` consuming the RFC #95 `suspend` terminal SSE
 * event (issue #435, Phase 2).
 *
 * `suspend` is a fourth terminal event parallel to `done`/`error`. The client
 * must translate it into a `SumeruSendOutcome` whose discriminant marks it
 * suspended — carrying the `SumeruSuspendValue` (`reason`/`nativeId`/`elapsedMs`)
 * and the assistant turns seen before the timeout, and crucially NO `done` —
 * rather than throwing "stream ended ... without done or error".
 */

import { describe, expect, test } from "vitest";

import { createSumeruClient } from "../src/sumeru-client/index.js";
import { installFetchStub, sseFrame } from "./fetch-stub.js";

describe("client.sendMessage — suspend terminal event (issue #435)", () => {
  const fetchStub = installFetchStub();

  test("suspend frame after assistant turns yields a suspended outcome (no done)", async () => {
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
        sseFrame(4, "suspend", {
          type: "@sumeru/suspend",
          value: { reason: "timeout", nativeId: "ses_native_abc", elapsedMs: 1800000 },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const outcome = await client.sendMessage({
      gateway: "claude-code",
      sessionId: "ses_abc",
      content: "do a long thing",
    });

    expect(outcome.kind).toBe("suspended");
    if (outcome.kind !== "suspended") throw new Error("expected suspended outcome");
    expect(outcome.suspend).toEqual({
      reason: "timeout",
      nativeId: "ses_native_abc",
      elapsedMs: 1800000,
    });
    // Turns gathered before the timeout are retained, not dropped.
    expect(outcome.assistantTurns.map((t) => t.content)).toEqual(["draft1", "draft2"]);
    // No `done` on the suspended variant.
    expect("done" in outcome).toBe(false);
  });

  test("suspend frame with no assistant turns still yields a suspended outcome", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "user", content: "go", timestamp: "", toolCalls: null },
        }),
        sseFrame(2, "suspend", {
          type: "@sumeru/suspend",
          value: { reason: "timeout", nativeId: "ses_native_xyz", elapsedMs: 60000 },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const outcome = await client.sendMessage({ gateway: "g", sessionId: "s", content: "x" });
    expect(outcome.kind).toBe("suspended");
    if (outcome.kind !== "suspended") throw new Error("expected suspended outcome");
    expect(outcome.suspend.nativeId).toBe("ses_native_xyz");
    expect(outcome.assistantTurns).toEqual([]);
  });

  test("suspend is terminal — frames after it are not consumed", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: {
            index: 0,
            role: "assistant",
            content: "partial",
            timestamp: "",
            toolCalls: null,
          },
        }),
        sseFrame(2, "suspend", {
          type: "@sumeru/suspend",
          value: { reason: "timeout", nativeId: "ses_native_abc", elapsedMs: 1800000 },
        }),
        // This trailing done MUST be ignored — the stream finished at suspend.
        sseFrame(3, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 99, tokens: null, durationMs: 1 },
        }),
      ],
    }));

    const client = createSumeruClient("http://127.0.0.1:7900");
    const outcome = await client.sendMessage({ gateway: "g", sessionId: "s", content: "x" });
    expect(outcome.kind).toBe("suspended");
  });

  test("malformed JSON in suspend frame rejects with first 200 chars", async () => {
    const badFrame = "id: 1\nevent: suspend\ndata: this-is-not-json\n\n";
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [badFrame],
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/suspend event has malformed JSON/);
  });

  test("suspend frame with wrong envelope type is a parse error", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "suspend", {
          type: "@sumeru/not-suspend",
          value: { reason: "timeout", nativeId: "ses_native_abc", elapsedMs: 1800000 },
        }),
      ],
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/suspend event missing @sumeru\/suspend envelope/);
  });

  test("suspend frame missing required value fields is a parse error", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "suspend", {
          type: "@sumeru/suspend",
          value: { reason: "timeout" }, // missing nativeId + elapsedMs
        }),
      ],
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    await expect(
      client.sendMessage({ gateway: "g", sessionId: "s", content: "x" }),
    ).rejects.toThrow(/suspend event missing @sumeru\/suspend envelope/);
  });

  test("completed stream (ending in done) remains a completed outcome", async () => {
    fetchStub.setHandler(() => ({
      kind: "sse",
      status: 200,
      frames: [
        sseFrame(1, "turn", {
          type: "@sumeru/turn",
          value: { index: 0, role: "assistant", content: "final", timestamp: "", toolCalls: null },
        }),
        sseFrame(2, "done", {
          type: "@sumeru/summary",
          value: { turnCount: 1, tokens: { in: 3, out: 7 }, durationMs: 9 },
        }),
      ],
    }));
    const client = createSumeruClient("http://127.0.0.1:7900");
    const outcome = await client.sendMessage({ gateway: "g", sessionId: "s", content: "x" });
    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") throw new Error("expected completed outcome");
    expect(outcome.output).toBe("final");
    expect(outcome.assistantTurnCount).toBe(1);
    expect(outcome.done.turnCount).toBe(1);
  });
});
