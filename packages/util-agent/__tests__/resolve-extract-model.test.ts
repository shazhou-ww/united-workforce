import { describe, expect, test } from 'vitest';
import type { WorkflowConfig } from "@united-workforce/protocol";
import { resolveExtractModelAlias } from "../src/extract.js";

function baseConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    providers: {},
    models: {
      sonnet: { provider: "openrouter", name: "anthropic/claude-sonnet-4" },
      "gpt4o-mini": { provider: "openai", name: "gpt-4o-mini" },
    },
    agents: {},
    defaultAgent: "hermes",
    agentOverrides: null,
    defaultModel: "sonnet",
    modelOverrides: null,
    ...overrides,
  };
}

describe("resolveExtractModelAlias", () => {
  test("uses modelOverrides.extract when set", () => {
    const config = baseConfig({
      modelOverrides: { extract: "gpt4o-mini" },
    });
    expect(resolveExtractModelAlias(config)).toBe("gpt4o-mini");
  });

  test("falls back to models.extract alias when present", () => {
    const config = baseConfig({
      models: {
        extract: { provider: "openai", name: "gpt-4o-mini" },
        sonnet: { provider: "openrouter", name: "anthropic/claude-sonnet-4" },
      },
    });
    expect(resolveExtractModelAlias(config)).toBe("extract");
  });

  test("falls back to defaultModel", () => {
    expect(resolveExtractModelAlias(baseConfig())).toBe("sonnet");
  });
});
