import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatLiveTimeLabel,
  LIVE_CONTENT_MAX_LINES,
  type LiveRoleRow,
  renderLiveRoleStepLines,
} from "../src/cmd-live.js";

const cliEntryPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("./fixtures/live", import.meta.url));

describe("live helpers", () => {
  test("formatLiveTimeLabel pads HH:MM:SS", () => {
    const label = formatLiveTimeLabel(new Date("2024-06-01T09:08:07.000Z").getTime());
    expect(label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
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

describe("live CLI", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-live-"));
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = storageRoot;
    await mkdir(join(storageRoot, "logs", "C9NMV6V2TQT81"), { recursive: true });
    await cp(
      join(fixtureRoot, "logs", "C9NMV6V2TQT81", "01LIVECMPLT01DDDDDDDDDDDDG.data.jsonl"),
      join(storageRoot, "logs", "C9NMV6V2TQT81", "01LIVECMPLT01DDDDDDDDDDDDG.data.jsonl"),
    );
    await cp(
      join(fixtureRoot, "logs", "C9NMV6V2TQT81", "01LIVEINFLY01DDDDDDDDDDDDG.data.jsonl"),
      join(storageRoot, "logs", "C9NMV6V2TQT81", "01LIVEINFLY01DDDDDDDDDDDDG.data.jsonl"),
    );
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = prevEnv;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("prints role steps and summary for a completed thread", async () => {
    const env = { ...process.env, UNCAGED_WORKFLOW_STORAGE_ROOT: storageRoot };
    const proc = spawn(process.execPath, [cliEntryPath, "live", "01LIVECMPLT01DDDDDDDDDDDDG"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = await new Promise<string>((resolve, reject) => {
      let buf = "";
      proc.stdout?.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
      });
      proc.stderr?.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
      });
      proc.on("error", reject);
      proc.on("exit", (code: number | null) => {
        if (code === 0) {
          resolve(buf);
        } else {
          reject(new Error(`exit ${code}: ${buf}`));
        }
      });
    });

    expect(stdout).toContain("planner");
    expect(stdout).toContain("coder");
    expect(stdout).toContain("meta:");
    expect(stdout).toContain('"phase":"plan"');
    expect(stdout).toContain("LINE10");
    expect(stdout).not.toContain("LINE11");
    expect(stdout).toContain("more line");
    expect(stdout).toContain("completed: returnCode=0");
    expect(stdout).toContain("fixture completed");
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

  test("follows file until WorkflowResult is appended", async () => {
    const env = { ...process.env, UNCAGED_WORKFLOW_STORAGE_ROOT: storageRoot };
    const dataPath = join(
      storageRoot,
      "logs",
      "C9NMV6V2TQT81",
      "01LIVEINFLY01DDDDDDDDDDDDG.data.jsonl",
    );

    const proc = spawn(process.execPath, [cliEntryPath, "live", "01LIVEINFLY01DDDDDDDDDDDDG"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise((r) => setTimeout(r, 120));
    const prior = await readFile(dataPath, "utf8");
    await writeFile(dataPath, `${prior}{"returnCode":0,"summary":"caught up"}\n`, "utf8");

    const stdout = await new Promise<string>((resolve, reject) => {
      let buf = "";
      proc.stdout?.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
      });
      proc.stderr?.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
      });
      proc.on("error", reject);
      proc.on("exit", (code: number | null) => {
        if (code === 0) {
          resolve(buf);
        } else {
          reject(new Error(`exit ${code}: ${buf}`));
        }
      });
    });

    expect(stdout).toContain("planner");
    expect(stdout).toContain("completed: returnCode=0");
    expect(stdout).toContain("caught up");
  });
});
