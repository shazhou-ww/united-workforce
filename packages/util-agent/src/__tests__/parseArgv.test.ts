import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("parseArgv empty prompt error message", () => {
  let stderrOutput: string;
  let _exitCode: number | null;
  const originalExit = process.exit;
  const originalStderrWrite = process.stderr.write;

  beforeEach(() => {
    stderrOutput = "";
    _exitCode = null;
    process.exit = ((code?: number) => {
      _exitCode = code ?? 1;
      throw new Error("process.exit called");
    }) as any;
    process.stderr.write = ((chunk: string) => {
      stderrOutput += chunk;
      return true;
    }) as any;
  });

  afterEach(() => {
    process.exit = originalExit;
    process.stderr.write = originalStderrWrite;
  });

  test("empty prompt produces error message mentioning template variables", async () => {
    const { parseArgv } = await import("../run.js");
    const argv = [
      "node",
      "uwf-hermes",
      "--thread",
      "01ABCDEFGHIJKLMNOPQRSTUVWX",
      "--role",
      "classifier",
      "--prompt",
      "",
    ];

    expect(() => parseArgv(argv)).toThrow("process.exit called");
    expect(stderrOutput).toContain("prompt");
    expect(stderrOutput).toContain("empty");
    expect(stderrOutput).toContain("template");
  });
});
