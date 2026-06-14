import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_TIMEOUT_MS,
  formatTimeoutSuspendMessage,
  resolveHermesTimeoutMs,
} from "../src/timeout.js";

describe("resolveHermesTimeoutMs", () => {
  describe("precedence: flag > env > default", () => {
    it("uses flag value over env when both set (300/60 -> 300_000)", () => {
      const result = resolveHermesTimeoutMs(["--thread", "T", "--timeout", "300", "--role", "R"], {
        UWF_HERMES_TIMEOUT: "60",
      });
      expect(result).toEqual({ ok: true, value: 300_000 });
    });

    it("uses flag when env is unset (300, unset -> 300_000)", () => {
      const result = resolveHermesTimeoutMs(["--timeout", "300"], {});
      expect(result).toEqual({ ok: true, value: 300_000 });
    });

    it("uses env when flag absent (absent, 60 -> 60_000)", () => {
      const result = resolveHermesTimeoutMs(["--thread", "T"], {
        UWF_HERMES_TIMEOUT: "60",
      });
      expect(result).toEqual({ ok: true, value: 60_000 });
    });

    it("uses default when env is empty string and flag absent", () => {
      const result = resolveHermesTimeoutMs([], { UWF_HERMES_TIMEOUT: "" });
      expect(result).toEqual({ ok: true, value: DEFAULT_PROMPT_TIMEOUT_MS });
    });

    it("uses default when both are unset", () => {
      const result = resolveHermesTimeoutMs([], {});
      expect(result).toEqual({ ok: true, value: DEFAULT_PROMPT_TIMEOUT_MS });
    });
  });

  describe("flag validation", () => {
    it("non-numeric flag value is an error", () => {
      const result = resolveHermesTimeoutMs(["--timeout", "abc"], {
        UWF_HERMES_TIMEOUT: "60",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/^--timeout must be a positive integer/);
      expect(result.error).toContain("abc");
    });

    it("zero is rejected", () => {
      const result = resolveHermesTimeoutMs(["--timeout", "0"], {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/--timeout/);
      expect(result.error).toContain("0");
    });

    it("negative is rejected", () => {
      const result = resolveHermesTimeoutMs(["--timeout", "-1"], {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/--timeout/);
      expect(result.error).toContain("-1");
    });

    it("decimal is rejected", () => {
      const result = resolveHermesTimeoutMs(["--timeout", "1.5"], {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/--timeout/);
    });

    it("empty value after --timeout is rejected", () => {
      const result = resolveHermesTimeoutMs(["--timeout", ""], {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/--timeout/);
    });

    it("missing value after --timeout (last token) is rejected", () => {
      const result = resolveHermesTimeoutMs(["--timeout"], {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/--timeout/);
    });

    it("flag error wins over env error when flag is present", () => {
      const result = resolveHermesTimeoutMs(["--timeout", "abc"], {
        UWF_HERMES_TIMEOUT: "also-bad",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/^--timeout/);
    });
  });

  describe("env validation", () => {
    it("non-numeric env value is an error", () => {
      const result = resolveHermesTimeoutMs([], { UWF_HERMES_TIMEOUT: "abc" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/^UWF_HERMES_TIMEOUT must be a positive integer/);
      expect(result.error).toContain("abc");
    });

    it("zero env value is rejected", () => {
      const result = resolveHermesTimeoutMs([], { UWF_HERMES_TIMEOUT: "0" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/UWF_HERMES_TIMEOUT/);
    });

    it("negative env value is rejected", () => {
      const result = resolveHermesTimeoutMs([], { UWF_HERMES_TIMEOUT: "-5" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/UWF_HERMES_TIMEOUT/);
    });

    it("empty env value falls through to default (NOT an error)", () => {
      const result = resolveHermesTimeoutMs([], { UWF_HERMES_TIMEOUT: "" });
      expect(result).toEqual({ ok: true, value: DEFAULT_PROMPT_TIMEOUT_MS });
    });

    it("decimal env value is rejected", () => {
      const result = resolveHermesTimeoutMs([], { UWF_HERMES_TIMEOUT: "60.5" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/UWF_HERMES_TIMEOUT/);
    });
  });

  describe("happy path conversions", () => {
    it("1 second -> 1_000 ms", () => {
      expect(resolveHermesTimeoutMs(["--timeout", "1"], {})).toEqual({
        ok: true,
        value: 1_000,
      });
    });

    it("3600 seconds (1h) -> 3_600_000 ms", () => {
      expect(resolveHermesTimeoutMs(["--timeout", "3600"], {})).toEqual({
        ok: true,
        value: 3_600_000,
      });
    });

    it("default is 10 minutes (600_000 ms)", () => {
      expect(DEFAULT_PROMPT_TIMEOUT_MS).toBe(10 * 60 * 1000);
      expect(DEFAULT_PROMPT_TIMEOUT_MS).toBe(600_000);
    });
  });
});

describe("formatTimeoutSuspendMessage", () => {
  it("formats default 600s as 10 minutes", () => {
    expect(formatTimeoutSuspendMessage(DEFAULT_PROMPT_TIMEOUT_MS)).toBe(
      "hermes prompt timed out after 10 minutes",
    );
  });

  it("formats custom 300s as 5 minutes", () => {
    expect(formatTimeoutSuspendMessage(300_000)).toBe("hermes prompt timed out after 5 minutes");
  });

  it("rounds half-minute values", () => {
    expect(formatTimeoutSuspendMessage(90_000)).toBe("hermes prompt timed out after 2 minutes");
  });
});
