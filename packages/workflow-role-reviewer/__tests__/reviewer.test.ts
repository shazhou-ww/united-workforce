import { describe, expect, test } from "bun:test";

import { reviewerMetaSchema, reviewerRole } from "../src/reviewer.js";

describe("reviewerRole", () => {
  test("dryRunMeta validates against schema", () => {
    const parsed = reviewerMetaSchema.safeParse(reviewerRole.dryRunMeta);
    expect(parsed.success).toBe(true);
  });

  test("system prompt is generic (no cwd)", () => {
    expect(reviewerRole.systemPrompt).toContain("code reviewer");
    expect(reviewerRole.systemPrompt).not.toContain("project is at");
  });
});
