import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatLiveDebugLine,
  formatLiveTimeLabel,
  LIVE_CONTENT_MAX_LINES,
  type LiveRoleRow,
  renderLiveRoleStepLines,
} from "../src/commands/thread/index.js";
import { parseLiveArgv } from "../src/live-argv.js";

const cliEntryPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

describe("live helpers", () => {
  test("formatLiveTimeLabel pads HH:MM:SS", () => {
    const label = formatLiveTimeLabel(new Date("2024-06-01T09:08:07.000Z").getTime());
    expect(label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("formatLiveDebugLine flattens newlines in message", () => {
    const line = formatLiveDebugLine(0, "TAG1", "a\nb");
    expect(line).toContain("[TAG1]");
    expect(line).toContain("a b");
    expect(line).not.toContain("\n");
  });

  test("renderLiveRoleStepLines truncates content to LIVE_CONTENT_MAX_LINES", () => {
    const lines = Array.from({ length: LIVE_CONTENT_MAX_LINES + 3 }, (_, i) => `L${i + 1}`);
    const row: LiveRoleRow = {
      role: "r",
      content: lines.join("\n"),
      meta: { k: "v" },
      timestamp: 0,
    };
    const out = renderLiveRoleStepLines(row, "r");
    const body = out.filter((l) => l.startsWith("  L"));
    expect(body.length).toBe(LIVE_CONTENT_MAX_LINES);
    expect(out.some((l) => l.includes("more line"))).toBe(true);
    expect(out.some((l) => l.startsWith("  meta: "))).toBe(true);
  });
});

describe("parseLiveArgv", () => {
  test("parses thread id and flags in any order", () => {
    const a = parseLiveArgv(["01ABC", "--debug", "--role", "planner"]);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.threadId).toBe("01ABC");
      expect(a.value.latest).toBe(false);
      expect(a.value.debug).toBe(true);
      expect(a.value.role).toBe("planner");
    }
    const b = parseLiveArgv(["--latest", "--role", "x"]);
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.value.latest).toBe(true);
      expect(b.value.threadId).toBe(null);
      expect(b.value.role).toBe("x");
    }
  });

  test("rejects --latest with thread id", () => {
    const r = parseLiveArgv(["--latest", "01ABC"]);
    expect(r.ok).toBe(false);
  });
});

describe("live CLI", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-live-"));
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = storageRoot;
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = prevEnv;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("unknown thread id exits 1", () => {
    const env = { ...process.env, UNCAGED_WORKFLOW_STORAGE_ROOT: storageRoot };
    const r = spawnSync(process.execPath, [cliEntryPath, "live", "01UNKNOWNXXXXXXXXXXXXXXXXX"], {
      env,
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(String(r.stderr ?? "")).toContain("thread not found");
  });
});

describe("live --latest with empty storage", () => {
  let prevEnv: string | undefined;
  let emptyRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    emptyRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-live-empty-"));
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = emptyRoot;
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = prevEnv;
    }
    await rm(emptyRoot, { recursive: true, force: true });
  });

  test("exits 1 when no threads exist", () => {
    const env = { ...process.env, UNCAGED_WORKFLOW_STORAGE_ROOT: emptyRoot };
    const r = spawnSync(process.execPath, [cliEntryPath, "live", "--latest"], {
      env,
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(String(r.stderr ?? "")).toContain("no threads");
  });
});
