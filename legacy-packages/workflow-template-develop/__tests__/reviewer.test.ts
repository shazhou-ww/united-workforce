import { describe, expect, test } from "bun:test";

import { reviewerMetaSchema, reviewerRole } from "../src/roles/reviewer.js";

describe("reviewerRole", () => {
  test("approved sample validates against schema", () => {
    const parsed = reviewerMetaSchema.safeParse({ status: "approved" as const });
    expect(parsed.success).toBe(true);
  });

  test("system prompt is generic (no cwd)", () => {
    expect(reviewerRole.systemPrompt).toContain("code reviewer");
    expect(reviewerRole.systemPrompt).not.toContain("project is at");
  });
});
