import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const THREAD_TS_PATH = fileURLToPath(new URL("../commands/thread.ts", import.meta.url));

describe("issue #180 — _workflowRef ghost parameter cleanup", () => {
  test("thread.ts no longer references the dead _workflowRef parameter", async () => {
    const source = await readFile(THREAD_TS_PATH, "utf8");
    expect(source).not.toContain("_workflowRef");
  });

  test("resolveActiveThreadStatus is declared with exactly 4 parameters", async () => {
    const source = await readFile(THREAD_TS_PATH, "utf8");
    const declMatch = source.match(/async function resolveActiveThreadStatus\s*\(([\s\S]*?)\)\s*:/);
    expect(declMatch).not.toBeNull();
    const paramList = (declMatch as RegExpMatchArray)[1];
    const params = paramList
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    expect(params).toHaveLength(4);
  });

  test("every call site of resolveActiveThreadStatus passes exactly 4 args", async () => {
    const source = await readFile(THREAD_TS_PATH, "utf8");
    // Capture call-site arg lists. Excludes the function declaration: it's
    // preceded by `function ` rather than parens-following-name.
    const callRe = /(?<!function\s)resolveActiveThreadStatus\s*\(([^)]*)\)/g;
    const callSites: string[] = [];
    for (const match of source.matchAll(callRe)) {
      callSites.push(match[1]);
    }
    expect(callSites.length).toBe(3);
    for (const args of callSites) {
      const argCount = args
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0).length;
      expect(argCount).toBe(4);
    }
  });
});
