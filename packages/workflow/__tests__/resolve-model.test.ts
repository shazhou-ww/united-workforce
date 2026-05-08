import { describe, expect, test } from "bun:test";

import { resolveModel } from "../src/config/resolve-model.js";
import type { WorkflowConfig } from "../src/registry/index.js";

function sampleConfig(): WorkflowConfig {
  return {
    maxDepth: 3,
    supervisorInterval: 3,
    providers: {
      dashscope: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "secret",
      },
      other: {
        baseUrl: "https://other.example/v1",
        apiKey: "k2",
      },
    },
    models: {
      default: "dashscope/qwen-plus",
      extract: "other/foo/bar-model",
    },
  };
}

describe("resolveModel", () => {
  test("uses explicit scene mapping", () => {
    const config = sampleConfig();
    const r = resolveModel(config, "extract");
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.baseUrl).toBe("https://other.example/v1");
    expect(r.value.apiKey).toBe("k2");
    expect(r.value.model).toBe("foo/bar-model");
  });

  test("falls back to models.default when scene is missing", () => {
    const config = sampleConfig();
    const r = resolveModel(config, "unknown-scene");
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.model).toBe("qwen-plus");
    expect(r.value.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  test("errs when scene missing and no default", () => {
    const config: WorkflowConfig = {
      maxDepth: 1,
      supervisorInterval: 3,
      providers: {
        p: { baseUrl: "https://x", apiKey: "k" },
      },
      models: {
        extract: "p/m",
      },
    };
    const r = resolveModel(config, "other");
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error).toContain("no model mapping");
    expect(r.error).toContain("default");
  });

  test("errs when provider is unknown", () => {
    const config: WorkflowConfig = {
      maxDepth: 1,
      supervisorInterval: 3,
      providers: {
        p: { baseUrl: "https://x", apiKey: "k" },
      },
      models: {
        default: "missing/m",
      },
    };
    const r = resolveModel(config, "any");
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error).toContain("unknown provider");
  });

  test("errs on invalid model reference shape", () => {
    const config: WorkflowConfig = {
      maxDepth: 1,
      supervisorInterval: 3,
      providers: {
        p: { baseUrl: "https://x", apiKey: "k" },
      },
      models: {
        default: "no-slash-model",
      },
    };
    const r = resolveModel(config, "x");
    expect(r.ok).toBe(false);
  });
});
