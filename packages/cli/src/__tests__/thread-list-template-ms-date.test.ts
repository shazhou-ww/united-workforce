import { OUTPUT_TEMPLATES } from "@united-workforce/protocol";
import { Liquid } from "liquidjs";
import { describe, expect, test } from "vitest";

/**
 * Issue #351 — `uwf thread list --format text` rendered the `STARTED` column
 * as `58414-12-06` because `THREAD_LIST_TEMPLATE` piped `item.startedAt` (Unix
 * **ms** per `THREAD_LIST_OUTPUT_SCHEMA`) directly into LiquidJS's `| date`
 * filter, which expects Unix **seconds**.
 *
 * This integration test renders the template against a known ms timestamp
 * and asserts the year falls within the realistic 20xx range, confirming
 * the ms→s conversion is in place at the protocol layer.
 */

function makeEngine(): Liquid {
  return new Liquid({ cache: false, strictFilters: false, strictVariables: false });
}

describe("THREAD_LIST_TEMPLATE rendering — issue #351 ms→s for `| date`", () => {
  test("renders item.startedAt=1781229932779 as a 2026 calendar date (not 58414)", async () => {
    const engine = makeEngine();
    const out = await engine.parseAndRender(OUTPUT_TEMPLATES["thread-list"], {
      items: [
        {
          threadId: "01K5HMKZQB7VDA8E2K9P3R5XBC",
          workflowHash: "WF1234567890A",
          workflowName: null,
          status: "idle",
          currentRole: "planner",
          startedAt: 1781229932779,
          completedAt: null,
        },
      ],
    });

    expect(out).not.toContain("58414");
    expect(out).toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    // The STARTED cell must NOT begin with a 5-digit year.
    expect(out).not.toMatch(/\b\d{5}-\d{2}-\d{2}\b/);
  });

  test("renders `-` for items with startedAt=null (null guard preserved)", async () => {
    const engine = makeEngine();
    const out = await engine.parseAndRender(OUTPUT_TEMPLATES["thread-list"], {
      items: [
        {
          threadId: "01K5HMKZQB7VDA8E2K9P3R5XBC",
          workflowHash: "WF1234567890A",
          workflowName: null,
          status: "idle",
          currentRole: "planner",
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    expect(out).not.toContain("58414");
    expect(out).not.toContain("Invalid Date");
    expect(out).not.toContain("1970-01-01");
    // Last token of the row is the rendered STARTED cell — must be `-`.
    const dataRow = out
      .split("\n")
      .find((line: string) => line.includes("01K5HMKZQB7VDA8E2K9P3R5XBC"));
    expect(dataRow).toBeDefined();
    expect(dataRow?.trimEnd().endsWith("-")).toBe(true);
  });

  test("renders multiple ms timestamps across years 2020–2030 with correct year prefix", async () => {
    const engine = makeEngine();
    const items = [
      {
        threadId: "ID1",
        workflowHash: "WF",
        workflowName: null,
        status: "idle",
        currentRole: null,
        startedAt: Date.UTC(2020, 0, 1, 0, 0, 0),
        completedAt: null,
      },
      {
        threadId: "ID2",
        workflowHash: "WF",
        workflowName: null,
        status: "idle",
        currentRole: null,
        startedAt: Date.UTC(2026, 5, 12, 5, 25, 0),
        completedAt: null,
      },
      {
        threadId: "ID3",
        workflowHash: "WF",
        workflowName: null,
        status: "idle",
        currentRole: null,
        startedAt: Date.UTC(2030, 11, 31, 23, 59, 0),
        completedAt: null,
      },
    ];

    const out = await engine.parseAndRender(OUTPUT_TEMPLATES["thread-list"], { items });

    expect(out).toContain("2020-");
    expect(out).toContain("2026-");
    expect(out).toContain("2030-");
    expect(out).not.toContain("58414");
    expect(out).not.toMatch(/\b\d{5}-\d{2}-\d{2}\b/);
  });
});
