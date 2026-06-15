import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(__dirname, "..", "src", "acp-client.ts");

describe("agent-hermes: buildSuspendOutput is hoisted to util-agent", () => {
  const source = readFileSync(SOURCE_PATH, "utf-8");

  test("no local function buildSuspendOutput definition remains", () => {
    expect(/^function buildSuspendOutput\b/m.test(source)).toBe(false);
  });

  test("imports buildSuspendOutput from @united-workforce/util-agent", () => {
    const importsFromUtilAgent =
      /import\s*\{[^}]*\bbuildSuspendOutput\b[^}]*\}\s*from\s*["']@united-workforce\/util-agent["']/s.test(
        source,
      );
    expect(importsFromUtilAgent).toBe(true);
  });
});
