import { describe, expect, test } from "bun:test";

import { err, ok } from "../src/result.js";

describe("result helpers", () => {
  test("ok wraps value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  test("err wraps error", () => {
    const r = err("nope");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("nope");
    }
  });
});
