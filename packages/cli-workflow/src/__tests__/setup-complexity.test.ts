import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  _discoverAgents,
  _isBackspace,
  _isTerminator,
  _parseWhichOutput,
  _printModelMenu,
  _printProviderMenu,
  _printValidationResult,
  _resolveModelChoice,
  _resolveProviderChoice,
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
    expect(_isTerminator("")).toBe(true);
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
    expect(_isBackspace("")).toBe(true);
  });
  test("\\b is a backspace", () => {
    expect(_isBackspace("\b")).toBe(true);
  });
  test("regular char is not a backspace", () => {
    expect(_isBackspace("x")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3a. _printProviderMenu
// ──────────────────────────────────────────────────────────────────────────────

describe("_printProviderMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const providers = [
    { name: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { name: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1" },
  ] as const;

  test("prints correct number of lines (one per provider + custom)", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      lines.push(msg);
    });
    _printProviderMenu(providers);
    // 2 providers + 1 custom = 3 lines
    expect(lines.length).toBe(3);
  });

  test("custom option number = providers.length + 1", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      lines.push(msg);
    });
    _printProviderMenu(providers);
    const lastLine = lines[lines.length - 1] ?? "";
    expect(lastLine).toMatch(/3\)/);
  });

  test("each provider line contains its label and baseUrl", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      lines.push(msg);
    });
    _printProviderMenu(providers);
    expect(lines[0]).toContain("OpenAI");
    expect(lines[0]).toContain("https://api.openai.com/v1");
    expect(lines[1]).toContain("xAI");
    expect(lines[1]).toContain("https://api.x.ai/v1");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3b. _resolveProviderChoice
// ──────────────────────────────────────────────────────────────────────────────

describe("_resolveProviderChoice", () => {
  const providers = [
    { name: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { name: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1" },
    { name: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  ] as const;

  test("valid index 1 returns first provider", () => {
    const result = _resolveProviderChoice("1", providers);
    expect(result).toEqual({ providerName: "openai", baseUrl: "https://api.openai.com/v1" });
  });

  test("valid index N (last preset) returns last provider", () => {
    const result = _resolveProviderChoice("3", providers);
    expect(result).toEqual({ providerName: "deepseek", baseUrl: "https://api.deepseek.com/v1" });
  });

  test("index providers.length+1 (custom) returns null", () => {
    const result = _resolveProviderChoice("4", providers);
    expect(result).toBeNull();
  });

  test("non-numeric string returns null", () => {
    expect(_resolveProviderChoice("abc", providers)).toBeNull();
  });

  test("0 returns null (out of range)", () => {
    expect(_resolveProviderChoice("0", providers)).toBeNull();
  });

  test("N+2 returns null (out of range)", () => {
    expect(_resolveProviderChoice("5", providers)).toBeNull();
  });

  test("negative number returns null", () => {
    expect(_resolveProviderChoice("-1", providers)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3c. _resolveModelChoice
// ──────────────────────────────────────────────────────────────────────────────

describe("_resolveModelChoice", () => {
  test("numeric input within range returns model at that index", () => {
    expect(_resolveModelChoice("2", ["a", "b", "c"])).toBe("b");
  });

  test("numeric input out of range returns input as-is", () => {
    expect(_resolveModelChoice("5", ["a"])).toBe("5");
  });

  test("non-numeric input returns input as-is", () => {
    expect(_resolveModelChoice("gpt-4o", ["a", "b"])).toBe("gpt-4o");
  });

  test("numeric input 1 returns first model", () => {
    expect(_resolveModelChoice("1", ["alpha", "beta"])).toBe("alpha");
  });

  test("empty models list with numeric input returns input as-is", () => {
    expect(_resolveModelChoice("1", [])).toBe("1");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3d. _printModelMenu
// ──────────────────────────────────────────────────────────────────────────────

describe("_printModelMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("prints all models — each model name appears in output", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      output.push(msg);
    });
    const models = ["model-a", "model-b", "model-c"];
    _printModelMenu(models, 100);
    const combined = output.join("\n");
    for (const m of models) {
      expect(combined).toContain(m);
    }
  });

  test("single column when termCols is very small", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      output.push(msg);
    });
    _printModelMenu(["a", "b", "c"], 1);
    // Each model on its own row → 3 lines
    expect(output.length).toBe(3);
  });

  test("wide terminal fits multiple columns", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      output.push(msg);
    });
    const models = Array.from({ length: 6 }, (_, i) => `m${i}`);
    _printModelMenu(models, 200);
    // With wide terminal and short names, should fit in fewer than 6 rows
    expect(output.length).toBeLessThan(6);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3e. _printValidationResult
// ──────────────────────────────────────────────────────────────────────────────

describe("_printValidationResult", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("ok=true prints success message containing '✓'", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      lines.push(msg);
    });
    _printValidationResult({ ok: true, error: null });
    expect(lines.join("\n")).toContain("✓");
  });

  test("ok=false prints warning message containing '⚠'", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      lines.push(msg);
    });
    _printValidationResult({ ok: false, error: "HTTP 401" });
    expect(lines.join("\n")).toContain("⚠");
  });

  test("ok=false includes the error string in output", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      lines.push(msg);
    });
    _printValidationResult({ ok: false, error: "HTTP 401" });
    expect(lines.join("\n")).toContain("HTTP 401");
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
