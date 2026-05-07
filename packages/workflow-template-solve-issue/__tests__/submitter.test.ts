import { describe, expect, test } from "bun:test";

import { submitterMetaSchema, submitterRole } from "../src/roles/submitter.js";

describe("submitterRole", () => {
  test("submitted sample validates against schema", () => {
    const parsed = submitterMetaSchema.safeParse({
      status: "submitted" as const,
      prUrl: "https://github.com/example/repo/pull/42",
    });
    expect(parsed.success).toBe(true);
  });

  test("failed sample validates against schema", () => {
    const parsed = submitterMetaSchema.safeParse({
      status: "failed" as const,
      error: "gh not authenticated",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects unknown status discriminant", () => {
    const parsed = submitterMetaSchema.safeParse({
      status: "queued",
      prUrl: "https://example.com",
    });
    expect(parsed.success).toBe(false);
  });

  test("exposes submitter system prompt", () => {
    expect(submitterRole.systemPrompt).toContain("submitter");
    expect(submitterRole.systemPrompt).toContain("pull request");
  });

  test("uses single extract mode without refs", () => {
    expect(submitterRole.extractMode).toBe("single");
    expect(submitterRole.extractRefs).toBeNull();
  });
});
