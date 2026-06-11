import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readThreadSteps } from "../src/judge/builtin/read-steps.js";

/**
 * Tests for the issue #308 in-repo consumer migration of
 * `packages/eval/src/judge/builtin/read-steps.ts`.
 *
 * Contracts:
 * 1. argv passed to `execFileSync` for `uwf step list` must include
 *    `--format raw-json` so a bare-value JSON payload (not text or envelope)
 *    is emitted.
 * 2. The parser must read `parsed.items` (not `parsed.steps`), return entries
 *    in the new `{ hash, role, durationMs }` shape, and must NOT call
 *    `.slice(1)` (the new payload has no leading start entry).
 */

let stubDir: string;
let stubPath: string;
let argLog: string;
let originalPath: string | undefined;

beforeEach(async () => {
  stubDir = await mkdtemp(join(tmpdir(), "uwf-eval-read-steps-"));
  argLog = join(stubDir, "argv.log");
  stubPath = join(stubDir, "uwf");
  await writeFile(
    stubPath,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(argLog)}`,
      // Echo the new step-list payload: { threadId, items: [...] }.
      `cat <<'JSON'`,
      `{`,
      `  "threadId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",`,
      `  "items": [`,
      `    { "hash": "AAAAAAAAAAAAA", "role": "planner",  "durationMs": 100 },`,
      `    { "hash": "BBBBBBBBBBBBB", "role": "developer", "durationMs": 200 }`,
      `  ]`,
      `}`,
      `JSON`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(stubPath, 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await rm(stubDir, { recursive: true, force: true });
});

async function readArgLog(): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(argLog, "utf8");
  return data.split("\n").filter((l) => l.length > 0);
}

describe("readThreadSteps() migration to --format raw-json + items payload", () => {
  test("argv includes --format raw-json", async () => {
    readThreadSteps("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    const calls = await readArgLog();
    expect(calls.length).toBeGreaterThan(0);
    const stepListCall = calls.find((c) => c.includes("step list"));
    expect(stepListCall).toBeDefined();
    expect(stepListCall).toContain("--format raw-json");
  });

  test("returns all items from new payload (no slice(1) — every entry is a real step)", () => {
    const result = readThreadSteps("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hash: "AAAAAAAAAAAAA", role: "planner", durationMs: 100 });
    expect(result[1]).toMatchObject({
      hash: "BBBBBBBBBBBBB",
      role: "developer",
      durationMs: 200,
    });
  });

  test("returns empty array when payload has no items", async () => {
    await writeFile(
      stubPath,
      [
        "#!/usr/bin/env bash",
        `cat <<'JSON'`,
        `{ "threadId": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "items": [] }`,
        `JSON`,
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(stubPath, 0o755);

    const result = readThreadSteps("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(result).toEqual([]);
  });
});
