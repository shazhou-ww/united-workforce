import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { validateCount } from "../commands/thread.js";

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli.js");

function runCli(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf8",
      env: { ...process.env, UWF_HOME: "/tmp/uwf-test-nonexistent" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("thread exec --count CLI parsing", { timeout: 30_000 }, () => {
  test("--help shows -c/--count option", () => {
    const result = runCli(["thread", "exec", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--count");
    expect(combined).toContain("-c");
  });

  test("description says 'one or more steps'", () => {
    const result = runCli(["thread", "exec", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("one or more steps");
  });
});

describe("validateCount", () => {
  test("count=0 throws validation error", () => {
    expect(() => validateCount(0)).toThrow("positive integer");
  });

  test("negative count throws validation error", () => {
    expect(() => validateCount(-1)).toThrow("positive integer");
  });

  test("non-integer count throws validation error", () => {
    expect(() => validateCount(1.5)).toThrow("positive integer");
  });

  test("count=1 passes validation", () => {
    expect(() => validateCount(1)).not.toThrow();
  });

  test("count=3 passes validation", () => {
    expect(() => validateCount(3)).not.toThrow();
  });
});
