import { describe, expect, test } from "vitest";
import { OUTPUT_TEMPLATES } from "../output-templates.js";

/**
 * Issue #351 — Liquid `| date` filter expects Unix seconds, but our payload
 * schemas store time-of-event fields in Unix milliseconds. Feeding ms directly
 * into `| date` overflows year 9999 and produces nonsensical years like 58414.
 *
 * Regression guard: every template that pipes a ms-typed schema field into
 * `| date` MUST first convert ms → s via `| divided_by: 1000` (or the
 * `1000.0` float variant), or use a registered custom `ms_date` filter.
 */

const MS_FIELDS = ["startedAt", "completedAt", "startedAtMs", "completedAtMs", "timestamp"];

describe("OUTPUT_TEMPLATES — ms→s conversion guard for `| date` (issue #351)", () => {
  test("THREAD_LIST_TEMPLATE divides item.startedAt by 1000 before piping to date", () => {
    const tpl = OUTPUT_TEMPLATES["thread-list"];
    // Must contain the corrected pipeline (whitespace-tolerant inside `{{ ... }}`).
    const corrected =
      /\{\{\s*item\.startedAt\s*\|\s*divided_by:\s*1000(?:\.0)?\s*\|\s*date:\s*"%Y-%m-%d %H:%M"\s*\}\}/;
    const msDateForm = /\{\{\s*item\.startedAt\s*\|\s*ms_date:\s*"%Y-%m-%d %H:%M"\s*\}\}/;
    expect(corrected.test(tpl) || msDateForm.test(tpl)).toBe(true);
  });

  test("THREAD_LIST_TEMPLATE does NOT pipe item.startedAt directly to date", () => {
    const tpl = OUTPUT_TEMPLATES["thread-list"];
    // The buggy form: `item.startedAt | date:` with no intervening `divided_by` or `ms_date`.
    const buggy = /\{\{\s*item\.startedAt\s*\|\s*date:/;
    expect(buggy.test(tpl)).toBe(false);
  });

  test("THREAD_LIST_TEMPLATE preserves the null guard for startedAt", () => {
    const tpl = OUTPUT_TEMPLATES["thread-list"];
    expect(tpl).toMatch(/\{%\s*if\s+item\.startedAt\s*%\}/);
    expect(tpl).toMatch(/\{%\s*else\s*%\}-\{%\s*endif\s*%\}/);
  });

  test("no template pipes a ms-typed field into `| date` without prior ms→s conversion", () => {
    for (const [name, tpl] of Object.entries(OUTPUT_TEMPLATES)) {
      for (const field of MS_FIELDS) {
        // Find every occurrence of `<...>field | ... | date:` and ensure that
        // somewhere between the field name and `| date:` there is a
        // `divided_by` filter (or the call is via a `ms_date` filter, which
        // we detect separately).
        const dateMatcher = new RegExp(
          `\\b${field}\\b\\s*((?:\\|\\s*[^|}]+)*?)\\s*\\|\\s*date:`,
          "g",
        );
        for (const match of tpl.matchAll(dateMatcher)) {
          const between = match[1] ?? "";
          const hasDividedBy = /\|\s*divided_by:\s*1000(?:\.0)?/.test(between);
          if (!hasDividedBy) {
            throw new Error(
              `Template "${name}" pipes ms-field "${field}" into "| date" without a "| divided_by: 1000" conversion: ${match[0]}`,
            );
          }
        }

        // ms_date is fine on its own — no extra check required, since it
        // bundles the conversion + format step.
      }
    }
    // If we get here without throwing, the guard passes.
    expect(true).toBe(true);
  });
});
