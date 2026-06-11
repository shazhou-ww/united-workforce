import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { execute } from "../src/runner/execute.js";

/**
 * Tests for the issue #308 in-repo consumer migration of
 * `packages/eval/src/runner/execute.ts`.
 *
 * Two contracts are exercised:
 *
 * 1. `runUwf` for `thread start` must include `--format raw-json` in argv and
 *    must read the thread id from `obj.threadId` (not the legacy `obj.thread`).
 *
 * 2. `runUwf` for `thread exec` must also include `--format raw-json` so its
 *    stdout is the bare `ThreadExecPayload` (not an envelope or text).
 *
 * The CLI is stubbed via the `UWF_BIN` env var — a tiny shell script captures
 * the full argv into a sentinel file and echoes the chosen payload.
 */

let stubDir: string;
let stubPath: string;
let argLog: string;

beforeEach(async () => {
  stubDir = await mkdtemp(join(tmpdir(), "uwf-eval-execute-"));
  argLog = join(stubDir, "argv.log");
  stubPath = join(stubDir, "uwf-stub.sh");
  await writeFile(
    stubPath,
    [
      "#!/usr/bin/env bash",
      // Append every invocation as a single line, args space-separated.
      `printf '%s\\n' "$*" >> ${JSON.stringify(argLog)}`,
      // Match against the full arg string so order-independence isn't needed.
      `args_str="$*"`,
      `case "$args_str" in`,
      `  *"thread start"*) echo '{"threadId":"01ARZ3NDEKTSV4RRFFQ69G5FAV","workflowHash":"ABCDEFGHIJKLM"}' ;;`,
      `  *"thread exec"*) echo '{"threadId":"01ARZ3NDEKTSV4RRFFQ69G5FAV","workflowHash":"ABCDEFGHIJKLM","steps":[]}' ;;`,
      `  *) echo '{}' ;;`,
      `esac`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(stubPath, 0o755);
  process.env.UWF_BIN = stubPath;
});

afterEach(async () => {
  delete process.env.UWF_BIN;
  await rm(stubDir, { recursive: true, force: true });
});

async function readArgLog(): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(argLog, "utf8");
  return data.split("\n").filter((l) => l.length > 0);
}

describe("execute() migration to --format raw-json + threadId", () => {
  test("thread start invocation includes --format raw-json", async () => {
    const result = await execute({
      workflow: "solve-issue",
      prompt: "fix it",
      agent: "uwf-mock",
      maxSteps: 1,
      workDir: stubDir,
    });
    expect(result.threadId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    const calls = await readArgLog();
    const startCall = calls.find((c) => c.includes("thread start"));
    expect(startCall).toBeDefined();
    expect(startCall).toContain("--format raw-json");
  });

  test("parseThreadId reads obj.threadId, not obj.thread", async () => {
    const result = await execute({
      workflow: "solve-issue",
      prompt: "fix it",
      agent: "uwf-mock",
      maxSteps: 1,
      workDir: stubDir,
    });
    expect(result.threadId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  test("thread exec invocation includes --format raw-json", async () => {
    await execute({
      workflow: "solve-issue",
      prompt: "fix it",
      agent: "uwf-mock",
      maxSteps: 3,
      workDir: stubDir,
    });
    const calls = await readArgLog();
    const execCall = calls.find((c) => c.includes("thread exec"));
    expect(execCall).toBeDefined();
    expect(execCall).toContain("--format raw-json");
  });

  test("missing threadId field throws an error mentioning threadId (not thread)", async () => {
    // Override stub so that thread start echoes only the workflowHash (no
    // threadId nor legacy thread). The migrated parser must complain about
    // the new field name in its error message.
    await writeFile(
      stubPath,
      [
        "#!/usr/bin/env bash",
        `args_str="$*"`,
        `case "$args_str" in`,
        `  *"thread start"*) echo '{"workflowHash":"ABCDEFGHIJKLM"}' ;;`,
        `  *) echo '{}' ;;`,
        `esac`,
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(stubPath, 0o755);

    await expect(
      execute({
        workflow: "solve-issue",
        prompt: "fix it",
        agent: "uwf-mock",
        maxSteps: 1,
        workDir: stubDir,
      }),
    ).rejects.toThrow(/threadId/);
  });
});
