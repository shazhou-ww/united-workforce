import { describe, expect, test } from "bun:test";

describe("RFC-001 thread JSONL shapes", () => {
  test("documents the `.data.jsonl` start record + role record keys", () => {
    const startRecord = {
      name: "solve-issue",
      hash: "C9NMV6V2TQT81",
      threadId: "01KQXKW18CT8G75T53R8F4G7YG",
      parameters: {
        prompt: "Fix the login redirect bug in #3",
        options: {
          maxRounds: 5,
          depth: 0,
        },
      },
      timestamp: 1714963200000,
    };

    const roleRecord = {
      role: "planner",
      content: "Plan: modify auth middleware...",
      meta: { plan: "...", files: ["src/auth.ts"] },
      refs: [] as string[],
      timestamp: 1714963201000,
    };

    expect(Object.keys(startRecord).sort()).toEqual(
      ["hash", "name", "parameters", "threadId", "timestamp"].sort(),
    );
    expect(Object.keys(roleRecord).sort()).toEqual(
      ["content", "meta", "refs", "role", "timestamp"].sort(),
    );
  });

  test("documents the `.info.jsonl` debug record keys", () => {
    const infoRecord = {
      tag: "4KNMR2PX",
      content: "Loading workflow bundle...",
      timestamp: 1714963200500,
    };

    expect(Object.keys(infoRecord).sort()).toEqual(["content", "tag", "timestamp"].sort());
  });
});
