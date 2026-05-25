import { execSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cmdCasPutText } from "../commands/cas.js";

let storageRoot: string;
let uwfPath: string;

beforeEach(async () => {
  storageRoot = join(
    tmpdir(),
    `uwf-cas-exit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(storageRoot, { recursive: true });

  // Find the uwf CLI path
  uwfPath = join(__dirname, "../../src/cli.ts");
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function execUwf(args: string[]): ExecResult {
  try {
    const stdout = execSync(`bun ${uwfPath} ${args.join(" ")}`, {
      env: { ...process.env, WORKFLOW_STORAGE_ROOT: storageRoot },
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "stdout" in error &&
      "stderr" in error &&
      "status" in error
    ) {
      return {
        stdout: (error.stdout as Buffer | string).toString(),
        stderr: (error.stderr as Buffer | string).toString(),
        exitCode: error.status as number,
      };
    }
    throw error;
  }
}

describe("uwf cas has CLI exit codes", () => {
  test("exits 0 when hash exists", async () => {
    // Setup: Create a temp storage root, put a text node, capture hash
    const putResult = await cmdCasPutText(storageRoot, "test content");
    const hash = putResult.hash;

    // Execute: uwf cas has <hash>
    const result = execUwf(["cas", "has", hash]);

    // Assert: stdout contains {"exists":true}, exit code === 0
    expect(result.stdout).toContain('"exists":true');
    expect(result.exitCode).toBe(0);
  });

  test("exits 1 when hash does not exist", () => {
    // Setup: Create a temp storage root (empty CAS store)
    // Execute: uwf cas has NOSUCHHASH123
    const result = execUwf(["cas", "has", "NOSUCHHASH123"]);

    // Assert: stdout contains {"exists":false}, exit code === 1
    expect(result.stdout).toContain('"exists":false');
    expect(result.exitCode).toBe(1);
  });

  test("JSON output format unchanged for exists=true", async () => {
    // Setup: Create store, put node
    const putResult = await cmdCasPutText(storageRoot, "test");
    const hash = putResult.hash;

    // Execute: uwf cas has <hash>
    const result = execUwf(["cas", "has", hash]);

    // Assert: stdout JSON parses correctly to {exists: true}
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toEqual({ exists: true });
  });

  test("JSON output format unchanged for exists=false", () => {
    // Setup: Create empty store
    // Execute: uwf cas has INVALID
    const result = execUwf(["cas", "has", "INVALID"]);

    // Assert: stdout JSON parses correctly to {exists: false}
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toEqual({ exists: false });
  });

  test("YAML output format preserves exit code behavior for exists=true", async () => {
    // Setup: Create store with node
    const putResult = await cmdCasPutText(storageRoot, "test");
    const hash = putResult.hash;

    // Execute: uwf --format yaml cas has <hash>
    const result = execUwf(["--format", "yaml", "cas", "has", hash]);

    // Assert: exit code === 0, output is YAML format
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("exists:");
    expect(result.stdout).toContain("true");
  });

  test("YAML output format preserves exit code behavior for exists=false", () => {
    // Setup: Create empty store
    // Execute: uwf --format yaml cas has INVALID
    const result = execUwf(["--format", "yaml", "cas", "has", "INVALID"]);

    // Assert: exit code === 1, output is YAML format
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("exists:");
    expect(result.stdout).toContain("false");
  });
});

describe("regression: other cas commands unaffected", () => {
  test("uwf cas get still exits 1 on not-found with error message", () => {
    // Execute: uwf cas get NOSUCHHASH
    const result = execUwf(["cas", "get", "NOSUCHHASH"]);

    // Assert: exit code === 1, stderr contains "Node not found"
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Node not found");
  });

  test("uwf cas put-text behavior unchanged", () => {
    // Execute: uwf cas put-text "hello"
    const result = execUwf(["cas", "put-text", "hello"]);

    // Assert: exit code === 0, returns hash
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toHaveProperty("hash");
    expect(typeof parsed.hash).toBe("string");
    expect(parsed.hash.length).toBe(13); // Crockford Base32 XXH64 hash length
  });
});
