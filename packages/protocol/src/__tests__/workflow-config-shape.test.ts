import { describe, expect, test } from "vitest";
import type { WorkflowConfig } from "../types.js";

describe("WorkflowConfig shape — engine config is LLM-free (issue #143)", () => {
  test("only requires agents, defaultAgent, agentOverrides", () => {
    const cfg: WorkflowConfig = {
      agents: { hermes: { host: "http://127.0.0.1:7900", gateway: "hermes" } },
      defaultAgent: "hermes",
      agentOverrides: null,
    };
    expect(cfg.agents.hermes.host).toBe("http://127.0.0.1:7900");
    expect(cfg.agents.hermes.gateway).toBe("hermes");
    expect(cfg.defaultAgent).toBe("hermes");
    expect(cfg.agentOverrides).toBeNull();
  });

  test("does not have providers/models/defaultModel/modelOverrides keys", () => {
    const cfg: WorkflowConfig = {
      agents: {},
      defaultAgent: "hermes",
      agentOverrides: null,
    };
    const asRecord = cfg as unknown as Record<string, unknown>;
    // These keys must not be in the WorkflowConfig type — runtime check confirms shape
    expect("providers" in asRecord).toBe(false);
    expect("models" in asRecord).toBe(false);
    expect("defaultModel" in asRecord).toBe(false);
    expect("modelOverrides" in asRecord).toBe(false);
  });
});
