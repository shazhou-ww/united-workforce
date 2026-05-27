import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PKG_ROOT = join(import.meta.dir, "..");

describe("Issue #551 — bin entry & engines", () => {
  test("package.json declares bun in engines", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.bun).toBeDefined();
    expect(pkg.engines.bun).toMatch(/^>=?\s*[\d.]+/);
  });

  test("bin entry file has bun shebang", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));
    const binPath = pkg.bin["uwf-hermes"];
    const content = readFileSync(join(PKG_ROOT, binPath), "utf-8");
    expect(content.startsWith("#!/usr/bin/env bun")).toBe(true);
  });

  test("README.md explains uwf-hermes is an adapter", () => {
    const readme = readFileSync(join(PKG_ROOT, "README.md"), "utf-8");
    expect(readme.toLowerCase()).toContain("adapter");
    expect(readme).toMatch(/uwf-hermes/);
    expect(readme).toMatch(/hermes/);
  });
});
