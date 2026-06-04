import { describe, expect, test } from "vitest";
import { parseTaskManifest } from "../src/task/index.js";

const VALID_YAML = `
name: fix-off-by-one
description: Fix an off-by-one error in a calculator
workflow: solve-issue
prompt: "Fix the bug: add(1,2) returns 4 instead of 3"
limits:
  maxSteps: 15
  timeoutMinutes: 30
judges:
  - name: frontmatter-compliance
    weight: 0.15
    builtin: true
  - name: test-pass
    weight: 0.3
    entry: dist/judges/test-pass.js
    schema: schemas/test-pass.json
`;

describe("parseTaskManifest", () => {
  test("parses valid task.yaml", () => {
    const manifest = parseTaskManifest(VALID_YAML);
    expect(manifest.name).toBe("fix-off-by-one");
    expect(manifest.description).toBe("Fix an off-by-one error in a calculator");
    expect(manifest.workflow).toBe("solve-issue");
    expect(manifest.prompt).toBe("Fix the bug: add(1,2) returns 4 instead of 3");
    expect(manifest.limits).toEqual({ maxSteps: 15, timeoutMinutes: 30 });
    expect(manifest.judges).toHaveLength(2);
  });

  test("parses builtin judge", () => {
    const manifest = parseTaskManifest(VALID_YAML);
    const builtin = manifest.judges[0];
    expect(builtin).toBeDefined();
    expect(builtin!.name).toBe("frontmatter-compliance");
    expect(builtin!.weight).toBe(0.15);
    expect(builtin!.builtin).toBe(true);
    expect(builtin!.entry).toBeNull();
  });

  test("parses custom judge with entry + schema", () => {
    const manifest = parseTaskManifest(VALID_YAML);
    const custom = manifest.judges[1];
    expect(custom).toBeDefined();
    expect(custom!.name).toBe("test-pass");
    expect(custom!.weight).toBe(0.3);
    expect(custom!.builtin).toBe(false);
    expect(custom!.entry).toBe("dist/judges/test-pass.js");
    expect(custom!.schema).toBe("schemas/test-pass.json");
  });

  test("defaults limits when omitted", () => {
    const yaml = `
name: minimal
workflow: solve-issue
prompt: do something
judges:
  - name: check
    builtin: true
`;
    const manifest = parseTaskManifest(yaml);
    expect(manifest.limits).toEqual({ maxSteps: 20, timeoutMinutes: 30 });
  });

  test("defaults description to empty string", () => {
    const yaml = `
name: no-desc
workflow: solve-issue
prompt: do something
judges:
  - name: check
    builtin: true
`;
    const manifest = parseTaskManifest(yaml);
    expect(manifest.description).toBe("");
  });

  test("rejects missing name", () => {
    const yaml = `
workflow: solve-issue
prompt: do something
judges:
  - name: check
    builtin: true
`;
    expect(() => parseTaskManifest(yaml)).toThrow("name is required");
  });

  test("rejects missing workflow", () => {
    const yaml = `
name: test
prompt: do something
judges:
  - name: check
    builtin: true
`;
    expect(() => parseTaskManifest(yaml)).toThrow("workflow is required");
  });

  test("rejects missing prompt", () => {
    const yaml = `
name: test
workflow: solve-issue
judges:
  - name: check
    builtin: true
`;
    expect(() => parseTaskManifest(yaml)).toThrow("prompt is required");
  });

  test("rejects empty judges array", () => {
    const yaml = `
name: test
workflow: solve-issue
prompt: do something
judges: []
`;
    expect(() => parseTaskManifest(yaml)).toThrow("at least one judge");
  });

  test("rejects non-builtin judge without entry", () => {
    const yaml = `
name: test
workflow: solve-issue
prompt: do something
judges:
  - name: custom-check
    weight: 0.5
`;
    expect(() => parseTaskManifest(yaml)).toThrow("non-builtin judge must have entry");
  });

  test("rejects non-object YAML root", () => {
    expect(() => parseTaskManifest("just a string")).toThrow("must be a YAML mapping");
  });

  test("rejects judge without name", () => {
    const yaml = `
name: test
workflow: solve-issue
prompt: do something
judges:
  - weight: 0.5
    builtin: true
`;
    expect(() => parseTaskManifest(yaml)).toThrow("name is required");
  });

  test("defaults weight to 0 when omitted", () => {
    const yaml = `
name: test
workflow: solve-issue
prompt: do something
judges:
  - name: token-stats
    builtin: true
`;
    const manifest = parseTaskManifest(yaml);
    expect(manifest.judges[0]!.weight).toBe(0);
  });
});
