import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "@ocas/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { storeBuiltinDetail } from "../src/detail.js";
import { appendSessionTurn, initSessionDir } from "../src/session.js";
import type { BuiltinTurnPayload } from "../src/types.js";

describe("storeBuiltinDetail", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "builtin-detail-storage-"));
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  const makeTurn = (role: "assistant" | "tool", content: string): BuiltinTurnPayload => ({
    role,
    content,
    toolCalls: null,
    reasoning: null,
  });

  test("stores detail with turns, returns hash and turnCount", async () => {
    const store = createMemoryStore();
    await initSessionDir(storageRoot);
    const sid = "detail-test";
    await appendSessionTurn(storageRoot, sid, makeTurn("tool", "question"));
    await appendSessionTurn(storageRoot, sid, makeTurn("assistant", "answer"));

    const result = await storeBuiltinDetail(store, storageRoot, sid, "test-model", 1000, 2000);
    expect(result.turnCount).toBe(2);
    expect(typeof result.detailHash).toBe("string");
    expect(result.detailHash.length).toBeGreaterThan(0);
  });

  test("empty session returns turnCount 0", async () => {
    const store = createMemoryStore();
    const sid = "empty-session";

    const result = await storeBuiltinDetail(store, storageRoot, sid, "test-model", 1000, 2000);
    expect(result.turnCount).toBe(0);
    expect(typeof result.detailHash).toBe("string");
  });
});
