import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const CLI_PATH = join(import.meta.dirname, "..", "cli.js");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("bun", ["run", CLI_PATH, ...args], {
      encoding: "utf8",
      env: { ...process.env, WORKFLOW_STORAGE_ROOT: "/tmp/uwf-test-nonexistent" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("thread step --count CLI parsing", () => {
  test("--help shows -c/--count option", () => {
    const result = runCli(["thread", "step", "--help"]);
    expect(result.stdout).toContain("--count");
    expect(result.stdout).toContain("-c");
  });

  test("description says 'one or more steps'", () => {
    const result = runCli(["thread", "step", "--help"]);
    expect(result.stdout).toContain("one or more steps");
  });
});

describe("cmdThreadStep count logic", () => {
  test("count=0 fails with validation error", () => {
    const result = runCli(["thread", "step", "FAKE_THREAD_ID", "-c", "0"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("positive integer");
  });

  test("negative count fails with validation error", () => {
    const result = runCli(["thread", "step", "FAKE_THREAD_ID", "-c", "-1"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("positive integer");
  });

  test("non-integer count fails with validation error", () => {
    const result = runCli(["thread", "step", "FAKE_THREAD_ID", "-c", "1.5"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("positive integer");
  });

  test("count=1 is the default (no -c flag)", () => {
    // Without -c, it should attempt to run 1 step (failing on missing thread, not on count validation)
    const result = runCli(["thread", "step", "FAKE_THREAD_ID"]);
    expect(result.exitCode).not.toBe(0);
    // Should NOT contain "positive integer" error — should fail on thread lookup instead
    expect(result.stderr).not.toContain("positive integer");
  });

  test("count=3 passes validation (fails on thread lookup)", () => {
    const result = runCli(["thread", "step", "FAKE_THREAD_ID", "-c", "3"]);
    expect(result.exitCode).not.toBe(0);
    // Should NOT contain "positive integer" error — should fail on thread/storage lookup
    expect(result.stderr).not.toContain("positive integer");
  });
});
