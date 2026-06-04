import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  appendSessionTurn,
  initSessionDir,
  readSessionTurns,
  removeSession,
} from "../src/session.js";
import type { BuiltinTurnPayload } from "../src/types.js";

describe("session", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "builtin-session-"));
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

  test("initSessionDir creates directory", async () => {
    await initSessionDir(storageRoot);
    expect(existsSync(join(storageRoot, "sessions"))).toBe(true);
  });

  test("append + read roundtrip", async () => {
    await initSessionDir(storageRoot);
    const sid = "test-session-1";
    const t1 = makeTurn("tool", "hello");
    const t2 = makeTurn("assistant", "hi there");
    await appendSessionTurn(storageRoot, sid, t1);
    await appendSessionTurn(storageRoot, sid, t2);
    const turns = await readSessionTurns(storageRoot, sid);
    expect(turns).toEqual([t1, t2]);
  });

  test("read from non-existent returns []", async () => {
    const turns = await readSessionTurns(storageRoot, "no-such-session");
    expect(turns).toEqual([]);
  });

  test("removeSession deletes file", async () => {
    await initSessionDir(storageRoot);
    const sid = "to-remove";
    await appendSessionTurn(storageRoot, sid, makeTurn("tool", "bye"));
    await removeSession(storageRoot, sid);
    const turns = await readSessionTurns(storageRoot, sid);
    expect(turns).toEqual([]);
  });

  test("removeSession on non-existent does not throw", async () => {
    await expect(removeSession(storageRoot, "ghost")).resolves.toBeUndefined();
  });
});
