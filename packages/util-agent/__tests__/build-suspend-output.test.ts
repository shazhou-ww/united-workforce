import { bootstrap, createMemoryStore, putSchema } from "@ocas/core";
import { SUSPEND_OUTPUT_SCHEMA, SUSPEND_STATUS } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";

import { buildSuspendOutput, trySuspendFastPath } from "../src/index.js";

describe("buildSuspendOutput — exported from public API", () => {
  test("is a function", () => {
    expect(typeof buildSuspendOutput).toBe("function");
  });
});

describe("buildSuspendOutput — wire format", () => {
  test("returns frontmatter-only markdown with the SUSPEND_STATUS constant", () => {
    expect(buildSuspendOutput("hello")).toBe(
      `---\n$status: ${SUSPEND_STATUS}\nreason: hello\n---\n`,
    );
  });

  test("uses the literal $SUSPEND value sourced from protocol", () => {
    // Sanity check: the constant we depend on is the expected wire value.
    expect(SUSPEND_STATUS).toBe("$SUSPEND");
    expect(buildSuspendOutput("x")).toContain("$status: $SUSPEND");
  });

  test("preserves trailing newline after the closing fence", () => {
    const out = buildSuspendOutput("hello");
    expect(out.endsWith("---\n")).toBe(true);
  });
});

describe("buildSuspendOutput — preserves arbitrary reason text verbatim", () => {
  test("preserves max-turns reason verbatim", () => {
    expect(buildSuspendOutput("max turns (90) reached")).toContain(
      "reason: max turns (90) reached",
    );
  });

  test("preserves hermes timeout reason verbatim", () => {
    expect(buildSuspendOutput("hermes prompt timed out after 10 minutes")).toContain(
      "reason: hermes prompt timed out after 10 minutes",
    );
  });
});

describe("buildSuspendOutput — round-trips through trySuspendFastPath", () => {
  test("produced output is consumed correctly by trySuspendFastPath", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const suspendSchema = await putSchema(store, SUSPEND_OUTPUT_SCHEMA);

    const raw = buildSuspendOutput("rate-limited");
    const result = await trySuspendFastPath(raw, suspendSchema, store);

    expect(result).not.toBeNull();
    expect(result?.frontmatter).toEqual({
      $status: SUSPEND_STATUS,
      reason: "rate-limited",
    });
    expect(result?.body).toBe("");
  });
});
