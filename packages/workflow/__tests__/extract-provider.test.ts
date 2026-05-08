import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getExtractProvider } from "../src/extract-provider.js";

describe("getExtractProvider", () => {
  test("returns provider when config.models.extract is present", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-ext-prov-ok-"));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "workflow.yaml"),
        `config:
  maxDepth: 3
  providers:
    dashscope:
      baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
      apiKey: literal-key
  models:
    default: dashscope/qwen-turbo
    extract: dashscope/qwen-plus
workflows: {}
`,
        "utf8",
      );
      const r = await getExtractProvider(root);
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      expect(r.value.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
      expect(r.value.model).toBe("qwen-plus");
      expect(r.value.apiKey).toBe("literal-key");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("errs when registry has no config section", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-ext-prov-missing-"));
    try {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "workflow.yaml"), "workflows: {}\n", "utf8");
      const r = await getExtractProvider(root);
      expect(r.ok).toBe(false);
      if (r.ok) {
        return;
      }
      expect(r.error).toContain("no global config");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves apiKey from env at registry read time", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-ext-prov-env-"));
    const prev = process.env.WF_GET_EXTRACT_PROVIDER_KEY;
    process.env.WF_GET_EXTRACT_PROVIDER_KEY = "resolved-secret";
    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "workflow.yaml"),
        `config:
  maxDepth: 1
  providers:
    p:
      baseUrl: https://example.com
      apiKey: env:WF_GET_EXTRACT_PROVIDER_KEY
  models:
    default: p/other-model
    extract: p/m
workflows: {}
`,
        "utf8",
      );
      const r = await getExtractProvider(root);
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      expect(r.value.apiKey).toBe("resolved-secret");
    } finally {
      if (prev === undefined) {
        delete process.env.WF_GET_EXTRACT_PROVIDER_KEY;
      } else {
        process.env.WF_GET_EXTRACT_PROVIDER_KEY = prev;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
