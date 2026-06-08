import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("util-agent — extract.ts deleted (issue #143)", () => {
  test("src/extract.ts no longer exists", () => {
    expect(existsSync(join(__dirname, "..", "src", "extract.ts"))).toBe(false);
  });
});
