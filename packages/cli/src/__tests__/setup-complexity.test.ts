import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  _discoverAgents,
  _isBackspace,
  _isTerminator,
  _parseWhichOutput,
  _searchPathDirs,
} from "../commands/setup.js";

// ──────────────────────────────────────────────────────────────────────────────
// 1a. _searchPathDirs
// ──────────────────────────────────────────────────────────────────────────────

describe("_searchPathDirs", () => {
  test("returns empty array for empty PATH", async () => {
    const result = await _searchPathDirs("");
    expect(result).toEqual([]);
  });

  test("finds uwf-hermes in a single dir", async () => {
    const dir = mkdirSync(join(tmpdir(), `uwf-test-${Date.now()}`), { recursive: true }) as
      | string
      | undefined;
    const actualDir = dir ?? join(tmpdir(), `uwf-test-${Date.now()}`);
    mkdirSync(actualDir, { recursive: true });
    const filePath = join(actualDir, "uwf-hermes");
    writeFileSync(filePath, "#!/bin/sh\n", { mode: 0o755 });
    const result = await _searchPathDirs(actualDir);
    expect(result).toContain("uwf-hermes");
  });

  test("skips non-uwf- prefixed binaries", async () => {
    const dir = join(tmpdir(), `uwf-test-${Date.now()}-2`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hermes"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir, "uwf-hermes"), "#!/bin/sh\n", { mode: 0o755 });
    const result = await _searchPathDirs(dir);
    expect(result).toEqual(["uwf-hermes"]);
  });

  test("skips entry named exactly 'uwf'", async () => {
    const dir = join(tmpdir(), `uwf-test-${Date.now()}-3`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "uwf"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir, "uwf-hermes"), "#!/bin/sh\n", { mode: 0o755 });
    const result = await _searchPathDirs(dir);
    expect(result).toEqual(["uwf-hermes"]);
  });

  test("skips non-executable files", async () => {
    const dir = join(tmpdir(), `uwf-test-${Date.now()}-4`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "uwf-foo"), "#!/bin/sh\n", { mode: 0o644 });
    const result = await _searchPathDirs(dir);
    expect(result).toEqual([]);
  });

  test("deduplicates across PATH dirs", async () => {
    const dir1 = join(tmpdir(), `uwf-test-${Date.now()}-5a`);
    const dir2 = join(tmpdir(), `uwf-test-${Date.now()}-5b`);
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir1, "uwf-hermes"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir2, "uwf-hermes"), "#!/bin/sh\n", { mode: 0o755 });
    const result = await _searchPathDirs(`${dir1}:${dir2}`);
    expect(result).toEqual(["uwf-hermes"]);
  });

  test("returns sorted array", async () => {
    const dir = join(tmpdir(), `uwf-test-${Date.now()}-6`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "uwf-zoo"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir, "uwf-alpha"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir, "uwf-mid"), "#!/bin/sh\n", { mode: 0o755 });
    const result = await _searchPathDirs(dir);
    expect(result).toEqual(["uwf-alpha", "uwf-mid", "uwf-zoo"]);
  });

  test("skips inaccessible/nonexistent directories silently", async () => {
    const result = await _searchPathDirs("/nonexistent-dir-xyz-abc-12345");
    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 1b. _parseWhichOutput
// ──────────────────────────────────────────────────────────────────────────────

describe("_parseWhichOutput", () => {
  test("returns empty array for empty string", () => {
    expect(_parseWhichOutput("")).toEqual([]);
  });

  test("parses single path", () => {
    expect(_parseWhichOutput("/usr/local/bin/uwf-hermes")).toEqual(["uwf-hermes"]);
  });

  test("parses multiple paths", () => {
    expect(_parseWhichOutput("/usr/local/bin/uwf-hermes\n/usr/bin/uwf-claude-code")).toEqual([
      "uwf-claude-code",
      "uwf-hermes",
    ]);
  });

  test("deduplicates identical basenames from different dirs", () => {
    expect(_parseWhichOutput("/a/uwf-hermes\n/b/uwf-hermes")).toEqual(["uwf-hermes"]);
  });

  test("skips blank lines", () => {
    expect(_parseWhichOutput("/a/uwf-hermes\n\n/b/uwf-cursor")).toEqual([
      "uwf-cursor",
      "uwf-hermes",
    ]);
  });

  test("skips entry named exactly 'uwf'", () => {
    expect(_parseWhichOutput("/usr/bin/uwf")).toEqual([]);
  });

  test("skips basenames not starting with uwf-", () => {
    expect(_parseWhichOutput("/usr/bin/node")).toEqual([]);
  });

  test("returns sorted array", () => {
    expect(_parseWhichOutput("/a/uwf-zoo\n/a/uwf-alpha")).toEqual(["uwf-alpha", "uwf-zoo"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2a. _isTerminator
// ──────────────────────────────────────────────────────────────────────────────

describe("_isTerminator", () => {
  test("\\n is a terminator", () => {
    expect(_isTerminator("\n")).toBe(true);
  });
  test("\\r is a terminator", () => {
    expect(_isTerminator("\r")).toBe(true);
  });
  test("\\u0004 (EOT) is a terminator", () => {
    expect(_isTerminator("")).toBe(true);
  });
  test("regular char is not a terminator", () => {
    expect(_isTerminator("a")).toBe(false);
  });
  test("empty string is not a terminator", () => {
    expect(_isTerminator("")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2b. _isBackspace
// ──────────────────────────────────────────────────────────────────────────────

describe("_isBackspace", () => {
  test("\\u007F is a backspace", () => {
    expect(_isBackspace("")).toBe(true);
  });
  test("\\b is a backspace", () => {
    expect(_isBackspace("\b")).toBe(true);
  });
  test("regular char is not a backspace", () => {
    expect(_isBackspace("x")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Regression
// ──────────────────────────────────────────────────────────────────────────────

describe("_discoverAgents regression", () => {
  test("returns an array (may be empty) — never throws", async () => {
    const result = await _discoverAgents();
    expect(Array.isArray(result)).toBe(true);
  });
});
