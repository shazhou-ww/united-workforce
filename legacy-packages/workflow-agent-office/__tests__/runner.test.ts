import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, mock, test } from "bun:test";
import { ok, err } from "@uncaged/workflow-util";
import type { SpawnCliConfig } from "@uncaged/workflow-util-agent";
import { editDocument, generateDocument } from "../src/runner.js";

type MockSpawnResult = Awaited<ReturnType<typeof import("@uncaged/workflow-util-agent").spawnCli>>;

function makeSpawn(result: MockSpawnResult) {
  return mock(async (_cmd: string, _args: string[], _opts: SpawnCliConfig) => result);
}

function tempDir(): string {
  const dir = join(tmpdir(), `office-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("generateDocument", () => {
  test("calls office-agent create with correct args and returns outputDocx path", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(ok("agent reply") as MockSpawnResult);
    // Simulate CLI creating the file
    const outFile = join(base, "thread1", "output.docx");
    mkdirSync(join(base, "thread1"), { recursive: true });
    writeFileSync(outFile, "");

    const result = await generateDocument(
      { outputDir: base, command: "office-agent", timeout: null },
      "thread1",
      "Write a report",
      spawnFn,
    );

    expect(result.outputDocx).toBe(outFile);
    expect(result.sourceDocx).toBeNull();
    expect(spawnFn.mock.calls[0][0]).toBe("office-agent");
    expect(spawnFn.mock.calls[0][1]).toEqual(["create", "Write a report", "-o", "output.docx"]);
    expect(spawnFn.mock.calls[0][2].cwd).toBe(join(base, "thread1"));
  });

  test("uses PATH office-agent when command is null", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    mkdirSync(join(base, "t2"), { recursive: true });
    writeFileSync(join(base, "t2", "output.docx"), "");

    await generateDocument(
      { outputDir: base, command: null, timeout: null },
      "t2",
      "Generate",
      spawnFn,
    );

    expect(spawnFn.mock.calls[0][0]).toBe("office-agent");
  });

  test("throws on non_zero_exit", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(
      err({ kind: "non_zero_exit", exitCode: 1, stdout: "", stderr: "error" }) as MockSpawnResult,
    );

    await expect(
      generateDocument({ outputDir: base, command: null, timeout: null }, "t3", "fail", spawnFn),
    ).rejects.toThrow("office-agent failed (exit 1)");
  });

  test("throws on timeout", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(err({ kind: "timeout" }) as MockSpawnResult);

    await expect(
      generateDocument({ outputDir: base, command: null, timeout: null }, "t4", "slow", spawnFn),
    ).rejects.toThrow("office-agent: timed out");
  });

  test("throws when output file not created", async () => {
    const base = tempDir();
    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // Do NOT create output.docx

    await expect(
      generateDocument({ outputDir: base, command: null, timeout: null }, "t5", "no file", spawnFn),
    ).rejects.toThrow("output file not found");
  });
});

describe("editDocument", () => {
  test("copies input to original.docx and modified.docx, calls edit, returns paths", async () => {
    const base = tempDir();
    // Create a fake inputDocx
    const inputFile = join(base, "source.docx");
    writeFileSync(inputFile, "original content");

    const spawnFn = makeSpawn(ok("") as MockSpawnResult);
    // Simulate CLI overwriting modified.docx
    const outDir = join(base, "te1");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "modified.docx"), "modified content");

    const result = await editDocument(
      { outputDir: base, command: "office-agent", timeout: null },
      "te1",
      "Edit the doc",
      inputFile,
      spawnFn,
    );

    expect(result.outputDocx).toBe(join(outDir, "modified.docx"));
    expect(result.sourceDocx).toBe(join(outDir, "original.docx"));
    expect(spawnFn.mock.calls[0][1]).toEqual(["edit", "modified.docx", "Edit the doc"]);
  });

  test("throws on spawn_failed", async () => {
    const base = tempDir();
    const inputFile = join(base, "src.docx");
    writeFileSync(inputFile, "");
    const spawnFn = makeSpawn(
      err({ kind: "spawn_failed", message: "not found" }) as MockSpawnResult,
    );

    await expect(
      editDocument({ outputDir: base, command: null, timeout: null }, "te2", "edit", inputFile, spawnFn),
    ).rejects.toThrow("spawn failed");
  });
});
