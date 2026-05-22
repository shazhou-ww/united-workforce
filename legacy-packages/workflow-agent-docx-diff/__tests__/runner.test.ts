import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@uncaged/workflow-util";
import type { SpawnCliConfig } from "@uncaged/workflow-util-agent";
import { runDocxDiff } from "../src/runner.js";

type MockSpawnResult = Awaited<ReturnType<typeof import("@uncaged/workflow-util-agent").spawnCli>>;

function makeSpawn(result: MockSpawnResult) {
  return mock(async (_cmd: string, _args: string[], _opts: SpawnCliConfig) => result);
}

function tempDir(): string {
  const dir = join(tmpdir(), `diff-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runDocxDiff", () => {
  test("exit 0: success, returns DifferMeta JSON", async () => {
    const dir = tempDir();
    const sourceDocx = join(dir, "original.docx");
    const modifiedDocx = join(dir, "modified.docx");
    const diffDocx = join(dir, "diff.docx");
    writeFileSync(sourceDocx, "");
    writeFileSync(modifiedDocx, "");

    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // simulate docx-diff creating the diff file
    writeFileSync(diffDocx, "");

    const raw = await runDocxDiff(
      { command: "docx-diff" },
      sourceDocx,
      modifiedDocx,
      diffDocx,
      spawnFn,
    );
    const meta = JSON.parse(raw);
    expect(meta.sourceDocx).toBe(sourceDocx);
    expect(meta.modifiedDocx).toBe(modifiedDocx);
    expect(meta.diffDocx).toBe(diffDocx);

    expect(spawnFn.mock.calls[0][1]).toEqual([
      sourceDocx,
      modifiedDocx,
      "--output",
      "docx",
      "--out-file",
      diffDocx,
    ]);
  });

  test("exit 1 (changes found): treated as success", async () => {
    const dir = tempDir();
    const sourceDocx = join(dir, "s.docx");
    const modifiedDocx = join(dir, "m.docx");
    const diffDocx = join(dir, "diff.docx");
    writeFileSync(sourceDocx, "");
    writeFileSync(modifiedDocx, "");
    writeFileSync(diffDocx, "");

    const spawnFn = makeSpawn(
      err({ kind: "non_zero_exit", exitCode: 1, stdout: "", stderr: "" }) as MockSpawnResult,
    );

    await expect(
      runDocxDiff({ command: "docx-diff" }, sourceDocx, modifiedDocx, diffDocx, spawnFn),
    ).resolves.toBeDefined();
  });

  test("exit 2: throws error", async () => {
    const dir = tempDir();
    const spawnFn = makeSpawn(
      err({
        kind: "non_zero_exit",
        exitCode: 2,
        stdout: "",
        stderr: "fatal error",
      }) as MockSpawnResult,
    );

    await expect(
      runDocxDiff({ command: null }, "s.docx", "m.docx", "diff.docx", spawnFn),
    ).rejects.toThrow("docx-diff failed");
  });

  test("timeout: throws error", async () => {
    const spawnFn = makeSpawn(err({ kind: "timeout" }) as MockSpawnResult);

    await expect(
      runDocxDiff({ command: null }, "s.docx", "m.docx", "diff.docx", spawnFn),
    ).rejects.toThrow("timed out");
  });

  test("throws when diff file not created", async () => {
    const dir = tempDir();
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // do NOT create diffDocx

    await expect(
      runDocxDiff({ command: null }, "s.docx", "m.docx", join(dir, "missing.docx"), spawnFn),
    ).rejects.toThrow("diff file not found");
  });

  test("uses PATH docx-diff when command is null", async () => {
    const dir = tempDir();
    const diffDocx = join(dir, "diff.docx");
    writeFileSync(diffDocx, "");
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);

    await runDocxDiff({ command: null }, "s.docx", "m.docx", diffDocx, spawnFn);

    expect(spawnFn.mock.calls[0][0]).toBe("docx-diff");
  });
});
