import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "../src/util/logger.js";

describe("createLogger", () => {
  test("writes JSONL records to a file sink", async () => {
    const dir = join(tmpdir(), `wf-log-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const logPath = join(dir, "test.log");
    const log = createLogger({ sink: { kind: "file", path: logPath } });
    log("01ABCDEF", "hello");
    const text = await readFile(logPath, "utf8");
    const line = text.trim().split("\n")[0];
    expect(line).toBeDefined();
    const obj = JSON.parse(line ?? "{}") as { tag: string; content: string; timestamp: number };
    expect(obj.tag).toBe("01ABCDEF");
    expect(obj.content).toBe("hello");
    expect(typeof obj.timestamp).toBe("number");
    await rm(dir, { recursive: true, force: true });
  });

  test("rejects invalid tags", () => {
    const log = createLogger({ sink: { kind: "stderr" } });
    expect(() => log("BAD", "x")).toThrow();
    expect(() => log("01abcdefg", "x")).toThrow();
    expect(() => log("01ABCDEO", "x")).toThrow();
  });
});
