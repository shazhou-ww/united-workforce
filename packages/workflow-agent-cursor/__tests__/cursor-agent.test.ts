import { describe, expect, test } from "bun:test";
import type { ExtractContext, ExtractFn } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";
import { createCursorAgent, validateCursorAgentConfig } from "../src/index.js";

const testExtract: ExtractFn = async <T extends Record<string, unknown>>(
  _schema: z.ZodType<T>,
  _prompt: string,
  _ctx: ExtractContext,
): Promise<{ meta: T; contentPayload: string; refs: string[] }> => ({
  meta: { workspace: "/tmp" } as unknown as T,
  contentPayload: "",
  refs: [],
});

describe("validateCursorAgentConfig", () => {
  test("accepts valid config", () => {
    const r = validateCursorAgentConfig({
      model: null,
      timeout: 0,
      extract: testExtract,
    });
    expect(r.ok).toBe(true);
  });

  test("rejects non-function extract", () => {
    const r = validateCursorAgentConfig({
      model: null,
      timeout: 0,
      extract: null as unknown as ExtractFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("extract");
    }
  });

  test("rejects negative timeout", () => {
    const r = validateCursorAgentConfig({
      model: null,
      timeout: -1,
      extract: testExtract,
    });
    expect(r.ok).toBe(false);
  });
});

describe("createCursorAgent", () => {
  test("returns an AgentFn", () => {
    const agent = createCursorAgent({
      model: null,
      timeout: 0,
      extract: testExtract,
    });
    expect(typeof agent).toBe("function");
  });

  test("throws on invalid config at construction", () => {
    expect(() =>
      createCursorAgent({
        model: null,
        timeout: -1,
        extract: testExtract,
      }),
    ).toThrow();
  });
});
