import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolvePathInWorkspace } from "../src/tools/path.js";

describe("resolvePathInWorkspace", () => {
  const root = join("/tmp", "uwf-workspace");

  test("resolves relative paths inside root", () => {
    const resolved = resolvePathInWorkspace(root, "src/foo.ts");
    expect(resolved).toBe(join(root, "src/foo.ts"));
  });

  test("rejects parent traversal", () => {
    expect(resolvePathInWorkspace(root, "../etc/passwd")).toBeNull();
  });
});
