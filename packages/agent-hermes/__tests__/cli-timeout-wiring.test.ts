import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "..", "src", "cli.ts");
const ACP_CLIENT_PATH = resolve(__dirname, "..", "src", "acp-client.ts");
const HERMES_PATH = resolve(__dirname, "..", "src", "hermes.ts");

describe("agent-hermes: cli.ts wires resolveHermesTimeoutMs", () => {
  const source = readFileSync(CLI_PATH, "utf-8");

  test("imports resolveHermesTimeoutMs from ./timeout.js", () => {
    expect(
      /import\s*\{[^}]*\bresolveHermesTimeoutMs\b[^}]*\}\s*from\s*["']\.\/timeout\.js["']/s.test(
        source,
      ),
    ).toBe(true);
  });

  test("calls resolveHermesTimeoutMs with argv.slice(2) and process.env", () => {
    expect(
      /resolveHermesTimeoutMs\(\s*process\.argv\.slice\(2\)\s*,\s*process\.env\s*\)/.test(source),
    ).toBe(true);
  });

  test("exits non-zero on resolver failure", () => {
    expect(/!timeoutResult\.ok/.test(source)).toBe(true);
    expect(/process\.exit\(1\)/.test(source)).toBe(true);
    expect(/process\.stderr\.write/.test(source)).toBe(true);
  });

  test("passes resolved timeout value into createHermesAgent", () => {
    expect(
      /createHermesAgent\(\s*resumeDisabled\s*,\s*timeoutResult\.value\s*\)/.test(source),
    ).toBe(true);
  });
});

describe("agent-hermes: acp-client.ts uses DEFAULT_PROMPT_TIMEOUT_MS constant", () => {
  const source = readFileSync(ACP_CLIENT_PATH, "utf-8");

  test("no hardcoded PROMPT_TIMEOUT_MS local constant remains", () => {
    expect(/^const PROMPT_TIMEOUT_MS\b/m.test(source)).toBe(false);
  });

  test("imports DEFAULT_PROMPT_TIMEOUT_MS from ./timeout.js", () => {
    expect(
      /import\s*\{[^}]*\bDEFAULT_PROMPT_TIMEOUT_MS\b[^}]*\}\s*from\s*["']\.\/timeout\.js["']/s.test(
        source,
      ),
    ).toBe(true);
  });

  test("imports formatTimeoutSuspendMessage from ./timeout.js", () => {
    expect(
      /import\s*\{[^}]*\bformatTimeoutSuspendMessage\b[^}]*\}\s*from\s*["']\.\/timeout\.js["']/s.test(
        source,
      ),
    ).toBe(true);
  });

  test("HermesAcpClient constructor accepts promptTimeoutMs with default", () => {
    expect(
      /constructor\s*\(\s*promptTimeoutMs\s*:\s*number\s*=\s*DEFAULT_PROMPT_TIMEOUT_MS\s*\)/.test(
        source,
      ),
    ).toBe(true);
  });
});

describe("agent-hermes: hermes.ts propagates promptTimeoutMs", () => {
  const source = readFileSync(HERMES_PATH, "utf-8");

  test("createHermesAgent signature accepts optional promptTimeoutMs", () => {
    expect(/promptTimeoutMs\?\s*:\s*number/.test(source)).toBe(true);
  });

  test("constructs HermesAcpClient with the resolved timeout", () => {
    expect(/new HermesAcpClient\(promptTimeoutMs\)/.test(source)).toBe(true);
  });
});
