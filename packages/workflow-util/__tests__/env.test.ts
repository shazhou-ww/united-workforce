import { describe, expect, test } from "bun:test";
import { optionalEnv, requireEnv } from "../src/env.js";

describe("requireEnv", () => {
  test("returns value when set", () => {
    process.env.TEST_REQ = "hello";
    expect(requireEnv("TEST_REQ", "missing")).toBe("hello");
    delete process.env.TEST_REQ;
  });

  test("throws with message when missing", () => {
    expect(() => requireEnv("TEST_MISSING_XYZ", "need this")).toThrow("need this");
  });

  test("throws when empty string", () => {
    process.env.TEST_EMPTY = "";
    expect(() => requireEnv("TEST_EMPTY", "cannot be empty")).toThrow("cannot be empty");
    delete process.env.TEST_EMPTY;
  });
});

describe("optionalEnv", () => {
  test("returns value when set", () => {
    process.env.TEST_OPT = "world";
    expect(optionalEnv("TEST_OPT")).toBe("world");
    expect(optionalEnv("TEST_OPT", "default")).toBe("world");
    delete process.env.TEST_OPT;
  });

  test("returns null when missing and no fallback", () => {
    expect(optionalEnv("TEST_MISSING_ABC")).toBeNull();
  });

  test("returns fallback when missing", () => {
    expect(optionalEnv("TEST_MISSING_ABC", "fallback")).toBe("fallback");
  });

  test("returns fallback when empty string", () => {
    process.env.TEST_EMPTY2 = "";
    expect(optionalEnv("TEST_EMPTY2", "fb")).toBe("fb");
    expect(optionalEnv("TEST_EMPTY2")).toBeNull();
    delete process.env.TEST_EMPTY2;
  });
});
