import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getDefaultWorkflowStorageRoot, getGlobalCasDir } from "../src/storage-root.js";

describe("getGlobalCasDir", () => {
  test("joins cas segment under explicit storage root", () => {
    expect(getGlobalCasDir("/tmp/wf-root")).toBe(join("/tmp/wf-root", "cas"));
  });

  test("defaults to default workflow root when storage root is undefined", () => {
    expect(getGlobalCasDir(undefined)).toBe(join(getDefaultWorkflowStorageRoot(), "cas"));
  });
});
