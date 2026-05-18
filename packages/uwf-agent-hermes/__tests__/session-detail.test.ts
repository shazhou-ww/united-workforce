import { describe, expect, test } from "bun:test";
import { createMemoryStore, refs, validate, walk } from "@uncaged/json-cas";

import {
  computeDurationMs,
  extractLastAssistantContent,
  messageToTurnPayload,
  parseSessionIdFromStdout,
  storeHermesSessionDetail,
} from "../src/session-detail.js";
import type { HermesSessionJson, HermesSessionMessage } from "../src/types.js";

describe("parseSessionIdFromStdout", () => {
  test("reads session_id from the last non-empty line", () => {
    const stdout = "Done.\n\nsession_id: 20260518_223724_45ab80\n";
    expect(parseSessionIdFromStdout(stdout)).toBe("20260518_223724_45ab80");
  });

  test("returns null when trailing line is not session_id", () => {
    expect(parseSessionIdFromStdout("only assistant text\n")).toBeNull();
  });
});

describe("messageToTurnPayload", () => {
  test("maps assistant tool_calls to toolCalls", () => {
    const msg: HermesSessionMessage = {
      role: "assistant",
      content: "",
      reasoning: null,
      tool_calls: [{ function: { name: "read_file", arguments: '{"path":"x"}' } }],
    };
    const turn = messageToTurnPayload(msg, 0);
    expect(turn).toEqual({
      index: 0,
      role: "assistant",
      content: "",
      toolCalls: [{ name: "read_file", args: '{"path":"x"}' }],
      reasoning: null,
    });
  });

  test("skips user messages", () => {
    const msg: HermesSessionMessage = {
      role: "user",
      content: "hi",
      reasoning: null,
      tool_calls: null,
    };
    expect(messageToTurnPayload(msg, 0)).toBeNull();
  });
});

describe("extractLastAssistantContent", () => {
  test("returns the last non-empty assistant content", () => {
    const messages: HermesSessionMessage[] = [
      { role: "assistant", content: "first", reasoning: null, tool_calls: null },
      { role: "tool", content: "tool output", reasoning: null, tool_calls: null },
      { role: "assistant", content: "", reasoning: null, tool_calls: null },
      { role: "assistant", content: "final answer", reasoning: null, tool_calls: null },
    ];
    expect(extractLastAssistantContent(messages)).toBe("final answer");
  });
});

describe("computeDurationMs", () => {
  test("computes elapsed time from session_start", () => {
    const now = Date.parse("2026-05-18T13:32:59.028640Z");
    const duration = computeDurationMs("2026-05-18T13:31:59.028640Z", now);
    expect(duration).toBe(60_000);
  });
});

describe("storeHermesSessionDetail", () => {
  test("stores hermes-detail root with cas_ref turns walkable", async () => {
    const session: HermesSessionJson = {
      session_id: "20260518_133159_6a84e8",
      model: "claude-opus-4.6",
      session_start: "2026-05-18T13:31:59.028640",
      messages: [
        { role: "user", content: "task", reasoning: null, tool_calls: null },
        {
          role: "assistant",
          content: "",
          reasoning: "thinking",
          tool_calls: [{ function: { name: "terminal", arguments: "{}" } }],
        },
        { role: "tool", content: "ok", reasoning: null, tool_calls: null },
        { role: "assistant", content: "done", reasoning: null, tool_calls: null },
      ],
    };

    const store = createMemoryStore();
    const now = Date.parse("2026-05-18T13:32:59.028640");
    const { detailHash, output } = await storeHermesSessionDetail(store, session, now);

    expect(output).toBe("done");

    const detailNode = store.get(detailHash);
    expect(detailNode).not.toBeNull();
    if (detailNode === null) {
      return;
    }
    expect(validate(store, detailNode)).toBe(true);
    expect(detailNode.payload).toMatchObject({
      sessionId: "20260518_133159_6a84e8",
      model: "claude-opus-4.6",
      duration: 60_000,
      turnCount: 3,
    });

    const turnRefs = refs(store, detailNode);
    expect(turnRefs).toHaveLength(3);

    const visited: string[] = [];
    walk(store, detailHash, (hash) => visited.push(hash));
    expect(visited).toContain(detailHash);
    for (const turnHash of turnRefs) {
      expect(visited).toContain(turnHash);
    }
  });
});
