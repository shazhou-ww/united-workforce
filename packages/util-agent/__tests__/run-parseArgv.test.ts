import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseArgv } from "../src/run.js";

describe("parseArgv", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns threadId, role, prompt for valid argv", () => {
    const result = parseArgv(["node", "script", "--thread", "abc123", "--role", "developer", "--prompt", "do stuff"]);
    expect(result).toEqual({ threadId: "abc123", role: "developer", prompt: "do stuff" });
  });

  it("exits when --thread is missing", () => {
    expect(() => parseArgv(["node", "script", "--role", "dev", "--prompt", "x"])).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when --role is missing", () => {
    expect(() => parseArgv(["node", "script", "--thread", "t1", "--prompt", "x"])).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when --prompt is missing", () => {
    expect(() => parseArgv(["node", "script", "--thread", "t1", "--role", "dev"])).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
