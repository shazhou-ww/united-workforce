import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Source-level verification that each adapter's `createAgent({...})` call
 * includes the new `fork: null` and `cleanup: null` fields.
 *
 * Adapters are CLI binaries that spawn external processes — runtime testing
 * requires real LLM environments — so we use static source inspection here.
 * Type-level correctness is enforced separately by `tsc --build`.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

const ADAPTERS: Array<{ name: string; path: string }> = [
  { name: "agent-mock", path: "packages/agent-mock/src/mock-agent.ts" },
  { name: "agent-builtin", path: "packages/agent-builtin/src/agent.ts" },
];

/** Find the matching `}` for the `{` at `openIdx` in `source`. */
function findMatchingBrace(source: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Extract the `createAgent({...})` block from adapter source. */
function extractCreateAgentBlock(source: string): string {
  const startIdx = source.indexOf("createAgent({");
  expect(startIdx).toBeGreaterThanOrEqual(0);
  const openIdx = source.indexOf("{", startIdx);
  const endIdx = findMatchingBrace(source, openIdx);
  expect(endIdx).toBeGreaterThan(openIdx);
  return source.slice(openIdx, endIdx + 1);
}

describe("adapter createAgent calls include fork: null and cleanup: null", () => {
  for (const adapter of ADAPTERS) {
    test(`${adapter.name} createAgent call includes fork: null and cleanup: null`, async () => {
      const source = await readFile(join(REPO_ROOT, adapter.path), "utf8");
      expect(source).toMatch(/createAgent\s*\(\s*\{/);
      const block = extractCreateAgentBlock(source);
      expect(block).toMatch(/fork:\s*null/);
      expect(block).toMatch(/cleanup:\s*null/);
    });
  }
});
