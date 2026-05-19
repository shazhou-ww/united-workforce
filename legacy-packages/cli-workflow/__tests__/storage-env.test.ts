import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultWorkflowStorageRoot } from "@uncaged/workflow-util";
import { resolveWorkflowStorageRoot } from "../src/storage-env.js";

describe("resolveWorkflowStorageRoot", () => {
  let savedInternal: string | undefined;
  let savedUser: string | undefined;

  beforeEach(() => {
    savedInternal = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    savedUser = process.env.WORKFLOW_STORAGE_ROOT;
    delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    delete process.env.WORKFLOW_STORAGE_ROOT;
  });

  afterEach(() => {
    if (savedInternal === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = savedInternal;
    }
    if (savedUser === undefined) {
      delete process.env.WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.WORKFLOW_STORAGE_ROOT = savedUser;
    }
  });

  test("returns default when no env vars are set", () => {
    expect(resolveWorkflowStorageRoot()).toBe(getDefaultWorkflowStorageRoot());
  });

  test("WORKFLOW_STORAGE_ROOT overrides default", () => {
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/custom-storage";
    expect(resolveWorkflowStorageRoot()).toBe("/tmp/custom-storage");
  });

  test("UNCAGED_WORKFLOW_STORAGE_ROOT takes priority over WORKFLOW_STORAGE_ROOT", () => {
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/user-path";
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = "/tmp/internal-path";
    expect(resolveWorkflowStorageRoot()).toBe("/tmp/internal-path");
  });

  test("ignores empty WORKFLOW_STORAGE_ROOT", () => {
    process.env.WORKFLOW_STORAGE_ROOT = "";
    expect(resolveWorkflowStorageRoot()).toBe(getDefaultWorkflowStorageRoot());
  });

  test("ignores empty UNCAGED_WORKFLOW_STORAGE_ROOT and falls through to WORKFLOW_STORAGE_ROOT", () => {
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = "";
    process.env.WORKFLOW_STORAGE_ROOT = "/tmp/user-fallback";
    expect(resolveWorkflowStorageRoot()).toBe("/tmp/user-fallback");
  });
});
