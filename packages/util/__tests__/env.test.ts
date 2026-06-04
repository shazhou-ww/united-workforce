import { describe, expect, it } from "vitest";
import { env } from "../src/env.js";

describe("env", () => {
  it("returns env value when set", () => {
    process.env.TEST_ENV_SET = "hello";
    expect(env("TEST_ENV_SET", "default")).toBe("hello");
    delete process.env.TEST_ENV_SET;
  });

  it("returns fallback when missing", () => {
    expect(env("TEST_ENV_MISSING_XYZ", "fallback")).toBe("fallback");
  });

  it("returns fallback when empty", () => {
    process.env.TEST_ENV_EMPTY = "";
    expect(env("TEST_ENV_EMPTY", "fb")).toBe("fb");
    delete process.env.TEST_ENV_EMPTY;
  });
});
