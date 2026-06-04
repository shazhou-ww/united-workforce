import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  getDefaultStorageRoot,
  getDefaultWorkflowStorageRoot,
  getGlobalCasDir,
} from "../src/storage-root.js";

describe("getDefaultStorageRoot", () => {
  it("returns homedir + /.uwf", () => {
    expect(getDefaultStorageRoot()).toBe(`${homedir()}/.uwf`);
  });
});

describe("getDefaultWorkflowStorageRoot", () => {
  it("returns same as getDefaultStorageRoot (deprecated alias)", () => {
    expect(getDefaultWorkflowStorageRoot()).toBe(getDefaultStorageRoot());
  });
});

describe("getGlobalCasDir", () => {
  it("appends /cas to given storage root", () => {
    expect(getGlobalCasDir("/tmp/test")).toBe("/tmp/test/cas");
  });

  it("falls back to default when undefined", () => {
    expect(getGlobalCasDir(undefined)).toBe(`${homedir()}/.uwf/cas`);
  });
});
