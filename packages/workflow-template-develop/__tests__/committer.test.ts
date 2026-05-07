import { describe, expect, test } from "bun:test";

import { committerMetaSchema, committerRole } from "../src/roles/committer.js";

describe("committerRole", () => {
  test("committed sample validates against schema", () => {
    const parsed = committerMetaSchema.safeParse({
      status: "committed" as const,
      branch: "feat/example",
      commitSha: "abc1234",
    });
    expect(parsed.success).toBe(true);
  });

  test("exposes generic committer system prompt", () => {
    expect(committerRole.systemPrompt).toContain("git committer");
    expect(committerRole.systemPrompt).not.toContain("project is at");
  });
});
