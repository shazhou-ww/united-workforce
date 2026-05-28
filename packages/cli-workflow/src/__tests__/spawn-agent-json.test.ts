import { describe, expect, test } from "vitest";

/**
 * B-group tests: validate JSON parsing logic used by spawnAgent.
 *
 * We test the parsing logic inline since spawnAgent is a private function.
 * These tests verify the contract: last line of stdout must be valid JSON
 * with a valid stepHash CasRef.
 */

const CASREF_PATTERN = /^[0-9A-HJ-NP-TV-Z]{13}$/;

function isCasRef(s: string): boolean {
  return CASREF_PATTERN.test(s);
}

type AdapterOutput = {
  stepHash: string;
  detailHash: string;
  role: string;
  frontmatter: Record<string, unknown>;
  body: string;
  startedAtMs: number;
  completedAtMs: number;
};

function parseAgentStdout(stdout: string): AdapterOutput {
  const line = stdout.trim().split("\n").pop()?.trim() ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`agent stdout last line is not valid JSON: ${line || "(empty)"}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof obj.stepHash !== "string" ||
    !isCasRef(obj.stepHash as string)
  ) {
    throw new Error(`agent stdout JSON missing valid stepHash: ${line}`);
  }
  return obj as unknown as AdapterOutput;
}

const VALID_OUTPUT: AdapterOutput = {
  stepHash: "0123456789ABC",
  detailHash: "DEFGH12345678",
  role: "planner",
  frontmatter: { $status: "ready", plan: "somehash" },
  body: "Plan body",
  startedAtMs: 1000,
  completedAtMs: 2000,
};

describe("spawnAgent JSON parsing", () => {
  test("B1. parses valid JSON from agent stdout", () => {
    const stdout = JSON.stringify(VALID_OUTPUT) + "\n";
    const result = parseAgentStdout(stdout);
    expect(result.stepHash).toBe("0123456789ABC");
    expect(result.detailHash).toBe("DEFGH12345678");
    expect(result.role).toBe("planner");
    expect(result.frontmatter).toEqual({ $status: "ready", plan: "somehash" });
    expect(result.body).toBe("Plan body");
    expect(result.startedAtMs).toBe(1000);
    expect(result.completedAtMs).toBe(2000);
  });

  test("B2. extracts stepHash for head pointer", () => {
    const stdout = JSON.stringify(VALID_OUTPUT) + "\n";
    const result = parseAgentStdout(stdout);
    expect(result.stepHash).toBe("0123456789ABC");
    expect(isCasRef(result.stepHash)).toBe(true);
  });

  test("B3. handles debug lines before JSON", () => {
    const debugLines = "[debug] loading context...\n[debug] running agent...\n";
    const stdout = debugLines + JSON.stringify(VALID_OUTPUT) + "\n";
    const result = parseAgentStdout(stdout);
    expect(result.stepHash).toBe("0123456789ABC");
  });

  test("B4. rejects non-JSON last line", () => {
    const stdout = "not-json-at-all\n";
    expect(() => parseAgentStdout(stdout)).toThrow("not valid JSON");
  });

  test("B5. rejects JSON missing stepHash", () => {
    const incomplete = { detailHash: "DEFGH12345678", role: "planner" };
    const stdout = JSON.stringify(incomplete) + "\n";
    expect(() => parseAgentStdout(stdout)).toThrow("missing valid stepHash");
  });

  test("B6. rejects JSON with invalid stepHash", () => {
    const bad = { ...VALID_OUTPUT, stepHash: "not-a-hash" };
    const stdout = JSON.stringify(bad) + "\n";
    expect(() => parseAgentStdout(stdout)).toThrow("missing valid stepHash");
  });
});
