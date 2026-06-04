import { describe, expect, it } from "vitest";
import { err, ok } from "../src/result.js";

describe("result", () => {
  describe("ok", () => {
    it("wraps a value", () => {
      const r = ok(42);
      expect(r).toEqual({ ok: true, value: 42 });
    });

    it("wraps a string value", () => {
      const r = ok("hello");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe("hello");
    });
  });

  describe("err", () => {
    it("wraps an error", () => {
      const r = err("fail");
      expect(r).toEqual({ ok: false, error: "fail" });
    });

    it("wraps an Error object", () => {
      const e = new Error("boom");
      const r = err(e);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(e);
    });
  });

  describe("type narrowing", () => {
    it("narrows ok result", () => {
      const r = ok(10) as ReturnType<typeof ok<number>> | ReturnType<typeof err<string>>;
      if (r.ok) {
        expect(r.value).toBe(10);
      } else {
        expect.unreachable();
      }
    });

    it("narrows err result", () => {
      const r = err("bad") as ReturnType<typeof ok<number>> | ReturnType<typeof err<string>>;
      if (!r.ok) {
        expect(r.error).toBe("bad");
      } else {
        expect.unreachable();
      }
    });
  });
});
