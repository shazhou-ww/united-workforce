import { describe, expect, test } from "bun:test";

import { committerMetaSchema, committerRole } from "../src/committer.js";

describe("committerRole", () => {
  test("dryRunMeta validates against schema", () => {
    const parsed = committerMetaSchema.safeParse(committerRole.dryRunMeta);
    expect(parsed.success).toBe(true);
  });

  test("exposes generic committer system prompt", () => {
    expect(committerRole.systemPrompt).toContain("git committer");
    expect(committerRole.systemPrompt).not.toContain("project is at");
  });
});
