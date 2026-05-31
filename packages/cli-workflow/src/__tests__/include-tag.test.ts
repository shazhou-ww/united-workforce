import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { createIncludeTag } from "../include.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "include-tag-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("!include tag", () => {
  test("includes .md file as string", async () => {
    await writeFile(join(tmpDir, "prompt.md"), "You are an analyst.");
    const yaml = "system: !include prompt.md";
    const result = parse(yaml, { customTags: [createIncludeTag(tmpDir)] });
    expect(result.system).toBe("You are an analyst.");
  });

  test("includes .json file as parsed object", async () => {
    await writeFile(join(tmpDir, "schema.json"), '{"type":"object","properties":{}}');
    const yaml = "outputSchema: !include schema.json";
    const result = parse(yaml, { customTags: [createIncludeTag(tmpDir)] });
    expect(result.outputSchema).toEqual({ type: "object", properties: {} });
  });

  test("includes .yaml file as parsed object", async () => {
    await writeFile(join(tmpDir, "config.yaml"), "key: value\nlist:\n  - a\n  - b");
    const yaml = "config: !include config.yaml";
    const result = parse(yaml, { customTags: [createIncludeTag(tmpDir)] });
    expect(result.config).toEqual({ key: "value", list: ["a", "b"] });
  });

  test("resolves relative subdirectory paths", async () => {
    const subdir = join(tmpDir, "roles");
    await mkdir(subdir, { recursive: true });
    await writeFile(join(subdir, "analyst.md"), "Analyze data.");
    const yaml = "system: !include roles/analyst.md";
    const result = parse(yaml, { customTags: [createIncludeTag(tmpDir)] });
    expect(result.system).toBe("Analyze data.");
  });

  test("throws on missing file", () => {
    const yaml = "system: !include nonexistent.md";
    expect(() => parse(yaml, { customTags: [createIncludeTag(tmpDir)] })).toThrow();
  });

  test("includes .txt file as string", async () => {
    await writeFile(join(tmpDir, "note.txt"), "Hello world");
    const yaml = "note: !include note.txt";
    const result = parse(yaml, { customTags: [createIncludeTag(tmpDir)] });
    expect(result.note).toBe("Hello world");
  });

  test("blocks path traversal with ../", async () => {
    const yaml = "secret: !include ../../etc/passwd";
    expect(() => parse(yaml, { customTags: [createIncludeTag(tmpDir)] })).toThrow(
      /path traversal blocked/,
    );
  });

  test("blocks absolute path traversal", async () => {
    const yaml = "secret: !include /etc/passwd";
    expect(() => parse(yaml, { customTags: [createIncludeTag(tmpDir)] })).toThrow(
      /path traversal blocked/,
    );
  });

  test("supports nested !include in yaml files", async () => {
    const subdir = join(tmpDir, "parts");
    await mkdir(subdir, { recursive: true });
    await writeFile(join(subdir, "inner.md"), "nested content");
    await writeFile(join(tmpDir, "outer.yaml"), "value: !include parts/inner.md");
    const yaml = "config: !include outer.yaml";
    const result = parse(yaml, { customTags: [createIncludeTag(tmpDir)] });
    expect(result.config).toEqual({ value: "nested content" });
  });
});
