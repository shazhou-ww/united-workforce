import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdLogClean, cmdLogList, cmdLogShow } from "../commands/log.js";

let storageRoot: string;

beforeEach(async () => {
  storageRoot = join(tmpdir(), `uwf-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(storageRoot, "logs"), { recursive: true });
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

const entry1 = JSON.stringify({
  ts: "2026-05-20T10:00:00.000Z",
  pid: "1716200000000-1234",
  tag: "W9F3RK2M",
  msg: "process start",
  thread: "01J1234ABCDEF",
  workflow: "solve-issue",
});

const entry2 = JSON.stringify({
  ts: "2026-05-20T10:00:01.000Z",
  pid: "1716200000000-1234",
  tag: "ABC12345",
  msg: "step executed",
  thread: "01J1234ABCDEF",
  workflow: "solve-issue",
});

const entry3 = JSON.stringify({
  ts: "2026-05-20T10:00:02.000Z",
  pid: "1716200000000-5678",
  tag: "XYZ98765",
  msg: "different process",
  thread: "01JOTHER000000",
  workflow: "review-code",
});

const oldEntry = JSON.stringify({
  ts: "2026-05-19T08:00:00.000Z",
  pid: "1716200000000-9999",
  tag: "OLD1TAG1",
  msg: "old entry",
  thread: "01JOLD0000000",
  workflow: "solve-issue",
});

const olderEntry = JSON.stringify({
  ts: "2026-05-18T08:00:00.000Z",
  pid: "1716200000000-0001",
  tag: "OLD2TAG2",
  msg: "older entry",
  thread: "01JOLDER00000",
  workflow: "review-code",
});

async function writeLogFiles(): Promise<void> {
  const logsDir = join(storageRoot, "logs");
  await writeFile(join(logsDir, "2026-05-20.jsonl"), [entry1, entry2, entry3].join("\n") + "\n");
  await writeFile(join(logsDir, "2026-05-19.jsonl"), oldEntry + "\n");
  await writeFile(join(logsDir, "2026-05-18.jsonl"), olderEntry + "\n");
}

describe("cmdLogList", () => {
  test("lists log files with sizes sorted by date descending", async () => {
    await writeLogFiles();
    const result = await cmdLogList(storageRoot);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("2026-05-20.jsonl");
    expect(result[0].date).toBe("2026-05-20");
    expect(result[0].size).toBeGreaterThan(0);
    expect(result[1].name).toBe("2026-05-19.jsonl");
    expect(result[2].name).toBe("2026-05-18.jsonl");
  });

  test("returns empty array when no log files exist", async () => {
    const result = await cmdLogList(storageRoot);
    expect(result).toEqual([]);
  });

  test("returns empty array when logs directory does not exist", async () => {
    const noLogsRoot = join(storageRoot, "nonexistent");
    await mkdir(noLogsRoot, { recursive: true });
    const result = await cmdLogList(noLogsRoot);
    expect(result).toEqual([]);
  });
});

describe("cmdLogShow", () => {
  test("filters by thread ID", async () => {
    await writeLogFiles();
    const result = await cmdLogShow(storageRoot, { thread: "01J1234ABCDEF", process: null, date: null });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.thread === "01J1234ABCDEF")).toBe(true);
  });

  test("filters by process ID", async () => {
    await writeLogFiles();
    const result = await cmdLogShow(storageRoot, { thread: null, process: "1716200000000-1234", date: null });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.pid === "1716200000000-1234")).toBe(true);
  });

  test("filters by date", async () => {
    await writeLogFiles();
    const result = await cmdLogShow(storageRoot, { thread: null, process: null, date: "2026-05-19" });
    expect(result).toHaveLength(1);
    expect(result[0].msg).toBe("old entry");
  });

  test("reads all files when no date filter", async () => {
    await writeLogFiles();
    const result = await cmdLogShow(storageRoot, { thread: null, process: null, date: null });
    expect(result).toHaveLength(5);
    // sorted by ts ascending
    expect(result[0].ts).toBe("2026-05-18T08:00:00.000Z");
    expect(result[4].ts).toBe("2026-05-20T10:00:02.000Z");
  });

  test("returns empty when no matches", async () => {
    await writeLogFiles();
    const result = await cmdLogShow(storageRoot, { thread: "NONEXISTENT", process: null, date: null });
    expect(result).toEqual([]);
  });

  test("combined thread + date filter", async () => {
    await writeLogFiles();
    const result = await cmdLogShow(storageRoot, { thread: "01J1234ABCDEF", process: null, date: "2026-05-20" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.thread === "01J1234ABCDEF")).toBe(true);
  });
});

describe("cmdLogClean", () => {
  test("deletes files before given date", async () => {
    await writeLogFiles();
    const result = await cmdLogClean(storageRoot, "2026-05-20");
    expect(result.deleted).toBe(2);
    const remaining = await readdir(join(storageRoot, "logs"));
    expect(remaining).toEqual(["2026-05-20.jsonl"]);
  });

  test("deletes nothing when all files are newer", async () => {
    await writeLogFiles();
    const result = await cmdLogClean(storageRoot, "2026-05-18");
    expect(result.deleted).toBe(0);
  });

  test("handles missing logs directory gracefully", async () => {
    const noLogsRoot = join(storageRoot, "nonexistent");
    await mkdir(noLogsRoot, { recursive: true });
    const result = await cmdLogClean(noLogsRoot, "2026-05-20");
    expect(result).toEqual({ deleted: 0 });
  });
});
