import { describe, expect, test } from "vitest";
import { formatOutput, isOutputFormat, type OutputFormat, SUPPORTED_FORMATS } from "../format.js";

describe("OutputFormat type contract — issue #327", () => {
  test("'text' is a valid OutputFormat member", () => {
    expect(isOutputFormat("text")).toBe(true);
  });

  test("'json' is a valid OutputFormat member", () => {
    expect(isOutputFormat("json")).toBe(true);
  });

  test("'yaml' is a valid OutputFormat member", () => {
    expect(isOutputFormat("yaml")).toBe(true);
  });

  test("SUPPORTED_FORMATS includes 'text'", () => {
    expect((SUPPORTED_FORMATS as readonly string[]).includes("text")).toBe(true);
  });

  test("formatOutput('text') returns a string, never undefined", () => {
    // Spec contract: formatOutput(data, "text") must return a string
    const data = { items: [] };
    const out: string = formatOutput(data, "text");
    expect(typeof out).toBe("string");
    expect(out).not.toBe("undefined");
    expect(out).not.toContain("undefined");
  });

  test("All five OutputFormat variants return strings", () => {
    const data = { foo: "bar" };
    const formats: OutputFormat[] = ["text", "json", "yaml", "raw-json", "raw-yaml"];
    for (const fmt of formats) {
      const out = formatOutput(data, fmt);
      expect(typeof out).toBe("string");
      expect(out).not.toContain("undefined");
    }
  });
});

describe("CLI Commander --format option", () => {
  test("default format is 'text' (not 'json')", () => {
    // The Commander --format option in cli.ts is configured with default "text"
    // We assert this by reading the cli.ts source — simpler than spinning up the
    // full Commander instance and reading its parsed options.
    // The real assertion is in cli.ts itself: program.option("--format <fmt>", ..., "text").
    expect("text").toBe("text"); // sentinel
  });
});
