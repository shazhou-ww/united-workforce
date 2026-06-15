import { describe, expect, test } from "vitest";
import * as utilAgent from "../src/index.js";

describe("util-agent public API — no LLM exports (issue #143)", () => {
  test("does NOT export extract", () => {
    expect((utilAgent as Record<string, unknown>).extract).toBeUndefined();
  });

  test("does NOT export resolveModel", () => {
    expect((utilAgent as Record<string, unknown>).resolveModel).toBeUndefined();
  });

  test("does NOT export resolveExtractModelAlias", () => {
    expect((utilAgent as Record<string, unknown>).resolveExtractModelAlias).toBeUndefined();
  });

  test("does NOT export ExtractResult or ResolvedLlmProvider type names at runtime", () => {
    const keys = Object.keys(utilAgent);
    expect(keys).not.toContain("ExtractResult");
    expect(keys).not.toContain("ResolvedLlmProvider");
  });

  test("still exports engine-level surface: createAgent, loadWorkflowConfig", () => {
    expect(utilAgent.createAgent).toBeDefined();
    expect(utilAgent.loadWorkflowConfig).toBeDefined();
  });

  test("Phase 4 cleanup (#381): adapter-only exports are removed from public API", () => {
    const keys = Object.keys(utilAgent);
    // session-cache helpers (per-agent SQLite cache) — replaced by broker session-store
    expect(keys).not.toContain("getCachedSessionId");
    expect(keys).not.toContain("setCachedSessionId");
    expect(keys).not.toContain("getAskSessionId");
    expect(keys).not.toContain("setAskSessionId");
    expect(keys).not.toContain("getCachePath");
    // External-CLI plumbing — broker no longer needs these
    expect(keys).not.toContain("parseArgv");
    expect(keys).not.toContain("buildContext");
    // buildContinuationPrompt and buildThreadProgress remain public —
    // broker-step.ts assembles the full agent prompt using them (#387).
    expect(keys).not.toContain("buildContextWithMeta");
    expect(keys).not.toContain("buildSuspendOutput");
  });
});
