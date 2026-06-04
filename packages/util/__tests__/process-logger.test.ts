import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createProcessLogger } from "../src/process-logger/index.js";

function logDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("createProcessLogger", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir !== undefined) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("writes init and log lines to dated JSONL under storage root", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "uwf-process-log-"));
    const plog = createProcessLogger({
      storageRoot: tmpDir,
      context: { thread: "THREAD01", workflow: "WORKFLOW01" },
    });

    expect(plog.pid).toMatch(/^\d+-\d+$/);

    plog.log("7NQW4HBT", "moderator selected role=planner", null);

    const logPath = join(tmpDir, "logs", `${logDateKey(new Date())}.jsonl`);
    const lines = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, string>);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.tag).toBe("W9F3RK2M");
    expect(lines[0]?.pid).toBe(plog.pid);
    expect(lines[0]?.thread).toBe("THREAD01");
    expect(lines[0]?.workflow).toBe("WORKFLOW01");
    expect(lines[0]?.msg).toContain("process start");
    expect(lines[0]?.msg).toContain("node=");

    expect(lines[1]?.tag).toBe("7NQW4HBT");
    expect(lines[1]?.msg).toBe("moderator selected role=planner");
    expect(lines[1]?.thread).toBe("THREAD01");
    expect(lines[1]?.workflow).toBe("WORKFLOW01");
  });

  test("creates logs directory when missing", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "uwf-process-log-"));
    createProcessLogger({
      storageRoot: tmpDir,
      context: { thread: null, workflow: null },
    });
    mkdirSync(join(tmpDir, "logs"), { recursive: true });
    expect(() =>
      readFileSync(join(tmpDir, "logs", `${logDateKey(new Date())}.jsonl`), "utf8"),
    ).not.toThrow();
  });

  test("merges per-call context into the JSONL entry", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "uwf-process-log-"));
    const plog = createProcessLogger({
      storageRoot: tmpDir,
      context: { thread: "T1", workflow: null },
    });
    plog.log("M3K8V9T1", "spawn agent", { command: "uwf-hermes", args: "tid role" });

    const logPath = join(tmpDir, "logs", `${logDateKey(new Date())}.jsonl`);
    const lines = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, string>);
    const last = lines[lines.length - 1];
    expect(last?.command).toBe("uwf-hermes");
    expect(last?.args).toBe("tid role");
  });
});
