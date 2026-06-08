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

  test("still exports engine-level surface: createAgent, loadWorkflowConfig, buildContext", () => {
    expect(utilAgent.createAgent).toBeDefined();
    expect(utilAgent.loadWorkflowConfig).toBeDefined();
    expect(utilAgent.buildContext).toBeDefined();
  });
});
