import { describe, expect, test } from "bun:test";
import { createMemoryStore, putSchema } from "@ocas/core";

import { tryFrontmatterFastPath } from "../src/frontmatter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLANNER_SCHEMA = {
  type: "object",
  properties: {
    $status: { type: "string", enum: ["ready", "failed"] },
    plan: { type: "string" },
  },
  required: ["$status"],
  additionalProperties: false,
};

describe("adapter-stdout: A4 retry loop survives JSON output", () => {
  test("A4. first extraction fails, second succeeds — final result has correct data", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, PLANNER_SCHEMA);

    // Simulate the retry loop from createAgent (run.ts lines 163-173):
    // First attempt: agent outputs garbage (no frontmatter)
    const badOutput = "Here is my response without frontmatter.\nJust plain text.";
    const firstAttempt = await tryFrontmatterFastPath(badOutput, schemaHash, store);
    expect(firstAttempt).toBeNull();

    // Second attempt (after correction message): agent outputs valid frontmatter
    const goodOutput = `---\n$status: ready\nplan: corrected-hash\n---\nCorrected body with valid frontmatter.`;
    const secondAttempt = await tryFrontmatterFastPath(goodOutput, schemaHash, store);

    expect(secondAttempt).not.toBeNull();
    expect(secondAttempt!.outputHash).toMatch(/^[0-9A-Z]{13}$/);
    expect(secondAttempt!.frontmatter).toEqual({ $status: "ready", plan: "corrected-hash" });
    expect(secondAttempt!.body).toBe("Corrected body with valid frontmatter.");

    // Verify the final AdapterOutput shape would be correct
    const adapterOutput = {
      stepHash: "MOCK_STEP_HASH",
      detailHash: "MOCK_DETAIL_HA",
      role: "planner",
      frontmatter: secondAttempt!.frontmatter,
      body: secondAttempt!.body,
      startedAtMs: 1000,
      completedAtMs: 2000,
      assembledPrompt: null,
    };

    const json = JSON.stringify(adapterOutput);
    const parsed = JSON.parse(json);
    expect(parsed.frontmatter).toEqual({ $status: "ready", plan: "corrected-hash" });
    expect(parsed.body).toBe("Corrected body with valid frontmatter.");
    expect(parsed.completedAtMs).toBeGreaterThanOrEqual(parsed.startedAtMs);
  });

  test("A4. all retries fail — extraction returns null on every attempt", async () => {
    const store = createMemoryStore();
    const schemaHash = await putSchema(store, PLANNER_SCHEMA);

    const MAX_RETRIES = 2;
    const badOutput = "No frontmatter here";

    // Simulate MAX_FRONTMATTER_RETRIES iterations all failing
    let extracted = await tryFrontmatterFastPath(badOutput, schemaHash, store);
    for (let retry = 0; retry < MAX_RETRIES && extracted === null; retry++) {
      // Each retry also gets bad output
      extracted = await tryFrontmatterFastPath(badOutput, schemaHash, store);
    }

    expect(extracted).toBeNull();
  });
});
