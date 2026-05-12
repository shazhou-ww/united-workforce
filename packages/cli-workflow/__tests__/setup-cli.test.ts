import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkflowRegistry } from "@uncaged/workflow-register";

import { runCli } from "../src/cli-dispatch.js";
import { cmdSetup } from "../src/commands/setup/index.js";

describe("setup command (CLI mode)", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-setup-"));
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = storageRoot;
    await mkdir(storageRoot, { recursive: true });
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = prevEnv;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("writes workflow.yaml with provider, models.default, and depth defaults", async () => {
    const r = await cmdSetup(storageRoot, {
      provider: "dashscope",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-test123",
      defaultModel: "dashscope/qwen-plus",
      initWorkspaceName: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }

    const reg = await readWorkflowRegistry(storageRoot);
    expect(reg.ok).toBe(true);
    if (!reg.ok) {
      return;
    }
    expect(reg.value.config).not.toBeNull();
    if (reg.value.config === null) {
      return;
    }
    expect(reg.value.config.providers.dashscope).toEqual({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-test123",
    });
    expect(reg.value.config.models.default).toBe("dashscope/qwen-plus");
    expect(reg.value.config.maxDepth).toBe(3);
    expect(reg.value.config.supervisorInterval).toBe(3);

    const raw = await readFile(join(storageRoot, "workflow.yaml"), "utf8");
    expect(raw).toContain("dashscope");
    expect(raw).toContain("qwen-plus");
  });

  test("idempotent: second run updates apiKey and preserves workflows", async () => {
    const initialYaml = `config:
  maxDepth: 7
  supervisorInterval: 2
  providers:
    dashscope:
      baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
      apiKey: sk-old
  models:
    default: dashscope/qwen-plus
workflows:
  keep-me:
    hash: "0000000000000"
    timestamp: 1
    history: []
`;
    await writeFile(join(storageRoot, "workflow.yaml"), initialYaml, "utf8");

    const r2 = await cmdSetup(storageRoot, {
      provider: "dashscope",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-newkey",
      defaultModel: "dashscope/qwen-plus",
      initWorkspaceName: null,
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) {
      return;
    }

    const reg = await readWorkflowRegistry(storageRoot);
    expect(reg.ok).toBe(true);
    if (!reg.ok || reg.value.config === null) {
      return;
    }
    expect(reg.value.config.providers.dashscope.apiKey).toBe("sk-newkey");
    expect(reg.value.config.maxDepth).toBe(7);
    expect(reg.value.config.supervisorInterval).toBe(2);
    expect(reg.value.workflows["keep-me"]).toBeDefined();
    if (reg.value.workflows["keep-me"] === undefined) {
      return;
    }
    expect(reg.value.workflows["keep-me"].hash).toBe("0000000000000");
  });

  test("runCli setup dispatches with flags and exits 0", async () => {
    const code = await runCli(storageRoot, [
      "setup",
      "--provider",
      "openai",
      "--base-url",
      "https://api.openai.com/v1",
      "--api-key",
      "sk-test",
      "--default-model",
      "openai/gpt-4o",
    ]);
    expect(code).toBe(0);
    const reg = await readWorkflowRegistry(storageRoot);
    expect(reg.ok).toBe(true);
    if (!reg.ok || reg.value.config === null) {
      return;
    }
    expect(reg.value.config.providers.openai.apiKey).toBe("sk-test");
    expect(reg.value.config.models.default).toBe("openai/gpt-4o");
  });
});
