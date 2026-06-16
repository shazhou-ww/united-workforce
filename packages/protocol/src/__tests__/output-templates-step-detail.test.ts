import { Liquid } from "liquidjs";
import { describe, expect, test } from "vitest";
import { OUTPUT_TEMPLATES } from "../output-templates.js";

/**
 * Issue #403 — `uwf step show` (text) must render the `--- Content ---` turn
 * block. PR #394 added a `Usage` line plus a `Turns` / `--- Content ---` block
 * to `STEP_DETAIL_TEMPLATE`, fed by `toStepDetailPayload`
 * (`packages/cli/src/output-mappers.ts`) which emits **top-level** `turns`
 * (normalized from `detail.turns`), `usage`, and `durationMs`. The
 * `@uwf/output/step-detail` schema `requires` top-level `turns` and `usage`.
 *
 * This guard pins the template to that top-level shape. Issue #403's
 * suggested-but-wrong "fix direction 1" (retargeting iteration to
 * `detail.turns`) would contradict the mapper + schema and is explicitly
 * forbidden here. Mirrors the `| date` ms→s guards in
 * `output-templates-ms-date.test.ts` (issue #351).
 */

const TEMPLATE = OUTPUT_TEMPLATES["step-detail"];

/** Render the step-detail template the same way `format.ts` does. */
async function render(context: Record<string, unknown>): Promise<string> {
  const engine = new Liquid({ cache: false, strictFilters: false, strictVariables: false });
  const out = await engine.parseAndRender(TEMPLATE, context);
  return out.replace(/\n+$/, "");
}

describe("STEP_DETAIL_TEMPLATE — top-level turns/usage invariant (issue #403)", () => {
  test("iterates the top-level `turns` collection (positive static invariant)", () => {
    expect(TEMPLATE).toMatch(/\{%\s*for\s+turn\s+in\s+turns\s*%\}/);
    expect(TEMPLATE).toMatch(/\{%\s*if\s+turns\s+and\s+turns\.size\s*>\s*0\s*%\}/);
    expect(TEMPLATE).toMatch(/\{\{\s*turn\.role\s*\}\}/);
    expect(TEMPLATE).toMatch(/\{\{\s*turn\.content\s*\}\}/);
  });

  test("references top-level `usage.*` and `durationMs` (positive static invariant)", () => {
    expect(TEMPLATE).toMatch(/\{\{\s*usage\.inputTokens\s*\}\}/);
    expect(TEMPLATE).toMatch(/\{\{\s*usage\.outputTokens\s*\}\}/);
    expect(TEMPLATE).toMatch(/\{\{\s*usage\.turns\s*\}\}/);
    expect(TEMPLATE).toMatch(/\bdurationMs\b/);
  });

  test("does NOT iterate or gate on `detail.turns` (anti-regression for #403 fix direction 1)", () => {
    expect(TEMPLATE).not.toMatch(/\{%\s*for\s+turn\s+in\s+detail\.turns\s*%\}/);
    expect(TEMPLATE).not.toMatch(/detail\.turns/);
  });

  test("renders the Content block from top-level turns, usage, and durationMs", async () => {
    const out = await render({
      hash: "ABCDEFGHIJKLM",
      role: "reviewer",
      agent: "claude-code",
      status: "reviewed",
      durationMs: 137400,
      usage: { inputTokens: 38612, outputTokens: 10584, turns: 9 },
      turns: [
        { role: "assistant", content: "A" },
        { role: "assistant", content: "B" },
      ],
    });

    expect(out).toContain("--- Content ---");
    expect(out).toContain("[assistant] A");
    expect(out).toContain("[assistant] B");
    expect(out).toContain("Turns   2");
    expect(out).toContain("Usage   38612 in / 10584 out / 9 turns");
    expect(out).toContain("Duration 137.4s");
  });

  test("omits the Turns / Content block when turns is empty, without throwing", async () => {
    const out = await render({
      hash: "ABCDEFGHIJKLM",
      role: "reviewer",
      agent: "claude-code",
      status: "reviewed",
      durationMs: 137400,
      usage: null,
      turns: [],
    });

    expect(out).toContain("Role    reviewer");
    expect(out).not.toContain("--- Content ---");
    expect(out).not.toMatch(/^Turns\s/m);
  });

  test("omits the Turns / Content block when turns is absent, without throwing", async () => {
    const out = await render({
      hash: "ABCDEFGHIJKLM",
      role: "reviewer",
      agent: "claude-code",
      status: "reviewed",
      durationMs: null,
      usage: null,
    });

    expect(out).toContain("Role    reviewer");
    expect(out).not.toContain("--- Content ---");
    expect(out).not.toMatch(/^Turns\s/m);
  });
});
