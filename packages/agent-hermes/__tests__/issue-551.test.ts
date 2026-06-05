import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Issue #551 — bin entry & engines", () => {
  test("package.json no longer declares bun in engines", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));
    expect(pkg.engines?.bun).toBeUndefined();
  });

  test("bin entry file has node shebang", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));
    const binPath = pkg.bin["uwf-hermes"];
    const content = readFileSync(join(PKG_ROOT, binPath), "utf-8");
    expect(content.startsWith("#!/usr/bin/env")).toBe(true);
    expect(content).toContain("node");
  });

  test("README.md explains uwf-hermes is an adapter", () => {
    const readme = readFileSync(join(PKG_ROOT, "README.md"), "utf-8");
    expect(readme.toLowerCase()).toContain("adapter");
    expect(readme).toMatch(/uwf-hermes/);
    expect(readme).toMatch(/hermes/);
  });
});
