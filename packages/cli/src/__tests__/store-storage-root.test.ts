import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getDefaultStorageRoot, getGlobalCasDir, resolveStorageRoot } from "../store.js";

describe("Storage root resolution", () => {
  const envKeys = ["UWF_HOME", "OCAS_HOME"] as const;
  const savedEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  test("getDefaultStorageRoot returns ~/.uwf", () => {
    expect(getDefaultStorageRoot()).toBe(join(homedir(), ".uwf"));
  });

  test("resolveStorageRoot uses UWF_HOME", () => {
    process.env.UWF_HOME = "/tmp/uwf-primary";
    expect(resolveStorageRoot()).toBe("/tmp/uwf-primary");
  });

  test("resolveStorageRoot falls back to default when UWF_HOME unset", () => {
    expect(resolveStorageRoot()).toBe(getDefaultStorageRoot());
  });

  test("getGlobalCasDir returns ~/.ocas by default", () => {
    const casDir = getGlobalCasDir();
    expect(casDir).toBe(join(homedir(), ".ocas"));
  });

  test("getGlobalCasDir respects OCAS_HOME", () => {
    process.env.OCAS_HOME = "/tmp/ocas-primary";
    expect(getGlobalCasDir()).toBe("/tmp/ocas-primary");
  });
});
