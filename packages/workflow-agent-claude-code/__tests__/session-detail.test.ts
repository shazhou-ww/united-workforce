import { describe, expect, test } from "bun:test";
import { createMemoryStore, walk } from "@uncaged/json-cas";
import {
  parseClaudeCodeJsonOutput,
  storeClaudeCodeDetail,
  storeClaudeCodeRawOutput,
} from "../src/session-detail.js";
import type { ClaudeCodeParsedResult } from "../src/types.js";

describe("parseClaudeCodeJsonOutput", () => {
  test("parses valid claude -p --output-format json output", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Done fixing bug",
      session_id: "75e2167f-abc",
      num_turns: 3,
      total_cost_usd: 0.08,
      duration_ms: 10276,
    });
    const parsed = parseClaudeCodeJsonOutput(stdout);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("result");
    expect(parsed!.subtype).toBe("success");
    expect(parsed!.result).toBe("Done fixing bug");
    expect(parsed!.sessionId).toBe("75e2167f-abc");
    expect(parsed!.numTurns).toBe(3);
    expect(parsed!.totalCostUsd).toBe(0.08);
    expect(parsed!.durationMs).toBe(10276);
  });

  test("parses error_max_turns result", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      result: "Ran out of turns",
      session_id: "abc-def",
      num_turns: 90,
      total_cost_usd: 1.5,
      duration_ms: 50000,
    });
    const parsed = parseClaudeCodeJsonOutput(stdout);
    expect(parsed).not.toBeNull();
    expect(parsed!.subtype).toBe("error_max_turns");
    expect(parsed!.result).toBe("Ran out of turns");
  });

  test("returns null for non-JSON output", () => {
    const parsed = parseClaudeCodeJsonOutput("Some random text\nwithout JSON");
    expect(parsed).toBeNull();
  });

  test("returns null when session_id is missing", () => {
    const stdout = JSON.stringify({ type: "result", result: "hi", subtype: "success" });
    const parsed = parseClaudeCodeJsonOutput(stdout);
    expect(parsed).toBeNull();
  });
});

describe("storeClaudeCodeDetail", () => {
  test("stores claude-code-detail CAS node and returns output + detailHash", async () => {
    const store = createMemoryStore();
    const parsed: ClaudeCodeParsedResult = {
      type: "result",
      subtype: "success",
      result: "The answer",
      sessionId: "abc-123",
      numTurns: 5,
      totalCostUsd: 0.12,
      durationMs: 15000,
    };

    const { detailHash, output, sessionId } = await storeClaudeCodeDetail(store, parsed);
    expect(detailHash).toHaveLength(13);
    expect(output).toBe("The answer");
    expect(sessionId).toBe("abc-123");

    const node = await store.get(detailHash);
    expect(node).not.toBeNull();
    expect(node!.payload.sessionId).toBe("abc-123");
    expect(node!.payload.numTurns).toBe(5);
    expect(node!.payload.totalCostUsd).toBe(0.12);
    expect(node!.payload.durationMs).toBe(15000);
  });

  test("detail node is walkable from root", async () => {
    const store = createMemoryStore();
    const parsed: ClaudeCodeParsedResult = {
      type: "result",
      subtype: "success",
      result: "walkable test",
      sessionId: "walk-123",
      numTurns: 1,
      totalCostUsd: 0.01,
      durationMs: 1000,
    };

    const { detailHash } = await storeClaudeCodeDetail(store, parsed);
    const visited: string[] = [];
    walk(store, detailHash, (hash) => visited.push(hash));
    expect(visited.length).toBeGreaterThan(0);
  });
});

describe("storeClaudeCodeRawOutput", () => {
  test("stores raw text when JSON parsing fails", async () => {
    const store = createMemoryStore();
    const rawText = "Claude produced plain text without JSON";
    const hash = await storeClaudeCodeRawOutput(store, rawText);
    expect(hash).toHaveLength(13);
    const node = await store.get(hash);
    expect(node).not.toBeNull();
    expect(node!.payload.text).toBe(rawText);
  });
});
