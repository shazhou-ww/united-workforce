import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getSumeruConfigPath, loadSumeruConfig, parseSumeruConfig } from "../src/config.js";

describe("getSumeruConfigPath", () => {
  test("joins storageRoot with agents/sumeru.yaml", () => {
    expect(getSumeruConfigPath("/tmp/uwf")).toBe("/tmp/uwf/agents/sumeru.yaml");
  });
});

describe("parseSumeruConfig", () => {
  test("happy path: one default instance + defaultGateway", () => {
    const yaml = `
instances:
  neko:
    url: https://oc-neko.shazhou.work/sumeru
    default: true
  kuma:
    url: https://oc-kuma.shazhou.work/sumeru
defaultGateway: claude-code
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultGateway).toBe("claude-code");
    expect(result.value.defaultInstanceName).toBe("neko");
    expect(result.value.instances.neko).toEqual({ url: "https://oc-neko.shazhou.work/sumeru" });
    expect(result.value.instances.kuma).toEqual({ url: "https://oc-kuma.shazhou.work/sumeru" });
  });

  test("single instance: default marker is optional", () => {
    const yaml = `
instances:
  solo:
    url: https://solo.example/sumeru
defaultGateway: claude-code
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultInstanceName).toBe("solo");
  });

  test("invalid YAML returns 'is not valid YAML' error", () => {
    const result = parseSumeruConfig("instances: [unclosed");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/is not valid YAML/);
  });

  test("missing instances returns 'has no instances' error", () => {
    const result = parseSumeruConfig("defaultGateway: x\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/has no instances/);
  });

  test("empty instances mapping returns 'has no instances' error", () => {
    const result = parseSumeruConfig("instances: {}\ndefaultGateway: x\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/has no instances/);
  });

  test("two instances, no default → 'mark exactly one' error", () => {
    const yaml = `
instances:
  a:
    url: https://a/
  b:
    url: https://b/
defaultGateway: claude-code
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/2 instances but none is marked default/);
  });

  test("multiple defaults → 'multiple instances marked' error", () => {
    const yaml = `
instances:
  a:
    url: https://a/
    default: true
  b:
    url: https://b/
    default: true
defaultGateway: claude-code
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/multiple instances marked default/);
  });

  test("missing defaultGateway → 'missing defaultGateway' error", () => {
    const yaml = `
instances:
  solo:
    url: https://a/
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing 'defaultGateway'/);
  });

  test("empty defaultGateway → 'missing defaultGateway' error", () => {
    const yaml = `
instances:
  solo:
    url: https://a/
defaultGateway: ""
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing 'defaultGateway'/);
  });

  test("trims trailing slashes from instance URLs", () => {
    const yaml = `
instances:
  solo:
    url: https://example.com/sumeru///
defaultGateway: claude-code
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instances.solo.url).toBe("https://example.com/sumeru");
  });

  test("rejects instance without url", () => {
    const yaml = `
instances:
  bad:
    default: true
defaultGateway: claude-code
`;
    const result = parseSumeruConfig(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/instance 'bad' requires a non-empty 'url'/);
  });
});

describe("loadSumeruConfig", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "sumeru-config-"));
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("missing file → error mentioning path + creation hint", async () => {
    await expect(loadSumeruConfig(storageRoot)).rejects.toThrow(
      /sumeru adapter config not found:.*sumeru\.yaml.*Create it/,
    );
  });

  test("invalid YAML → error mentioning path", async () => {
    await mkdir(join(storageRoot, "agents"), { recursive: true });
    await writeFile(join(storageRoot, "agents", "sumeru.yaml"), "instances: [unclosed");
    await expect(loadSumeruConfig(storageRoot)).rejects.toThrow(
      /sumeru adapter config .*sumeru\.yaml is not valid YAML/,
    );
  });

  test("happy path → returns parsed config", async () => {
    await mkdir(join(storageRoot, "agents"), { recursive: true });
    await writeFile(
      join(storageRoot, "agents", "sumeru.yaml"),
      "instances:\n  solo:\n    url: https://x/\ndefaultGateway: gw\n",
    );
    const config = await loadSumeruConfig(storageRoot);
    expect(config.defaultGateway).toBe("gw");
    expect(config.defaultInstanceName).toBe("solo");
    expect(config.instances.solo.url).toBe("https://x");
  });
});
