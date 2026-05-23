import { describe, expect, test } from "bun:test";
import { resolvePath } from "../src/tools/path.js";
import { resolve } from "node:path";

describe("resolvePath", () => {
  test("resolves relative paths against cwd", () => {
    const root = "/workspace/project";
    const resolved = resolvePath(root, "src/foo.ts");
    expect(resolved).toBe(resolve(root, "src/foo.ts"));
  });

  test("resolves absolute paths as-is", () => {
    const resolved = resolvePath("/workspace", "/etc/hosts");
    expect(resolved).toBe("/etc/hosts");
  });

  test("resolves parent traversal normally", () => {
    const resolved = resolvePath("/workspace/project", "../other/file.ts");
    expect(resolved).toBe(resolve("/workspace/project", "../other/file.ts"));
  });
});
