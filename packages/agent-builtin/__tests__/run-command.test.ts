import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCommandTool } from "../src/tools/run-command.js";

const ctx = { cwd: tmpdir(), storageRoot: tmpdir() };

describe("runCommandTool", () => {
  it("runs echo command and checks stdout", async () => {
    const result = await runCommandTool.execute({ command: "echo hello" }, ctx);
    expect(result).toContain("hello");
    expect(result).toContain("stdout");
  });

  it("returns exit code", async () => {
    const result = await runCommandTool.execute({ command: "exit 0" }, ctx);
    expect(result).toContain("exit_code: 0");
  });

  it("returns non-zero exit code", async () => {
    const result = await runCommandTool.execute({ command: "exit 42" }, ctx);
    expect(result).toContain("exit_code: 42");
  });

  it("returns error when command is not a string", async () => {
    const result = await runCommandTool.execute({ command: 123 }, ctx);
    expect(result).toBe("Error: command must be a string");
  });

  it("returns error when args is null", async () => {
    const result = await runCommandTool.execute(null, ctx);
    expect(result).toBe("Error: command must be a string");
  });

  it("custom cwd works", async () => {
    const result = await runCommandTool.execute({ command: "pwd", cwd: "/tmp" }, ctx);
    expect(result).toContain("/tmp");
  });
});
