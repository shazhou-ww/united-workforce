import { describe, expect, test } from "vitest";
import { toWorkflowAddPayload, type WorkflowAddPayload } from "../output-mappers.js";

describe("toWorkflowAddPayload — issue #334", () => {
  test("maps WorkflowAddOutput { name, hash } to plain payload shape", () => {
    const out = toWorkflowAddPayload({ name: "review-pr", hash: "2TBP6T37TZAJZ" });
    expect(out).toEqual({ name: "review-pr", hash: "2TBP6T37TZAJZ" });
  });

  test("returns a WorkflowAddPayload type with exactly two fields", () => {
    const out: WorkflowAddPayload = toWorkflowAddPayload({
      name: "solve-issue",
      hash: "76C98RVXA5E4F",
    });
    expect(Object.keys(out).sort()).toEqual(["hash", "name"]);
  });

  test("performs no I/O — pure data mapping", () => {
    // Repeated calls produce equal results
    const a = toWorkflowAddPayload({ name: "a", hash: "AAA1234567890" });
    const b = toWorkflowAddPayload({ name: "a", hash: "AAA1234567890" });
    expect(a).toEqual(b);
  });
});
