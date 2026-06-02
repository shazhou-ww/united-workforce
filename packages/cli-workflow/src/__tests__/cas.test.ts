import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdCasHas, cmdCasPutText } from "../commands/cas.js";

let storageRoot: string;

beforeEach(async () => {
  storageRoot = join(tmpdir(), `uwf-cas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(storageRoot, { recursive: true });
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

describe("cmdCasHas", () => {
  test("returns {exists: true} for existing hash", async () => {
    // Setup: Create a test store, put a node, get its hash
    const putResult = await cmdCasPutText(storageRoot, "test content");
    const hash = putResult.hash;

    // Execute: Call cmdCasHas with the valid hash
    const result = await cmdCasHas(storageRoot, hash);

    // Assert: Result equals {exists: true}
    expect(result).toEqual({ exists: true });
  });

  test("returns {exists: false} for non-existent hash", async () => {
    // Setup: Create an empty test store
    // (storageRoot already created in beforeEach)

    // Execute: Call cmdCasHas with an invalid hash
    const result = await cmdCasHas(storageRoot, "INVALIDHASH12");

    // Assert: Result equals {exists: false}
    expect(result).toEqual({ exists: false });
  });

  test("does not throw for non-existent hash", async () => {
    // Setup: Create an empty test store
    // Execute & Assert: Does not throw, returns {exists: false}
    await expect(cmdCasHas(storageRoot, "NOSUCHHASH123")).resolves.toEqual({
      exists: false,
    });
  });

  test("handles malformed hash gracefully", async () => {
    // Setup: Create a test store
    // Execute: Call cmdCasHas with a too-short hash
    const result = await cmdCasHas(storageRoot, "xyz");

    // Assert: Returns {exists: false} (store.has() returns false)
    expect(result).toEqual({ exists: false });
  });

  test("handles empty hash string", async () => {
    // Execute: Call cmdCasHas with an empty string
    const result = await cmdCasHas(storageRoot, "");

    // Assert: Returns {exists: false}
    expect(result).toEqual({ exists: false });
  });

  test("handles hash with special characters", async () => {
    // Execute: Call cmdCasHas with special characters
    const result = await cmdCasHas(storageRoot, "HASH!@#");

    // Assert: Returns {exists: false}
    expect(result).toEqual({ exists: false });
  });
});
