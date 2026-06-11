import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "@ocas/fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isOutputFormat, type OutputFormat, SUPPORTED_FORMATS, writeEnvelope } from "../format.js";
import { registerUwfSchemas, type UwfSchemaHashes } from "../schemas.js";

let tmp: string;
let store: Awaited<ReturnType<typeof openStore>>;
let schemas: UwfSchemaHashes;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "uwf-write-envelope-"));
  store = await openStore(tmp);
  schemas = await registerUwfSchemas(store);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function captureStdout<T>(fn: () => Promise<T>): { result: Promise<T>; output: string[] } {
  const buf: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ): boolean => {
    buf.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write);
  return {
    result: (async () => {
      try {
        return await fn();
      } finally {
        spy.mockRestore();
      }
    })(),
    output: buf,
  };
}

describe("isOutputFormat type guard", () => {
  test("accepts every supported format", () => {
    for (const fmt of SUPPORTED_FORMATS) {
      expect(isOutputFormat(fmt)).toBe(true);
    }
  });

  test("rejects unknown formats", () => {
    expect(isOutputFormat("xml")).toBe(false);
    expect(isOutputFormat("")).toBe(false);
    expect(isOutputFormat("JSON")).toBe(false);
  });
});

describe("SUPPORTED_FORMATS", () => {
  test("contains exactly the five formats specified in cli-envelope-writer.md", () => {
    expect([...SUPPORTED_FORMATS].sort()).toEqual(["json", "raw-json", "raw-yaml", "text", "yaml"]);
  });
});

describe("writeEnvelope — json format", () => {
  test("emits {type,value} JSON envelope with trailing newline", async () => {
    const payload = { valid: true, errors: [] };
    const { result, output } = captureStdout(async () =>
      writeEnvelope(payload, "validate-result", { format: "json", store, schemas }),
    );
    await result;

    const out = output.join("");
    expect(out.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      type: schemas.outputs["validate-result"],
      value: { valid: true, errors: [] },
    });
  });
});

describe("writeEnvelope — yaml format", () => {
  test("emits envelope yaml with type then value keys", async () => {
    const payload = { valid: false, errors: ["a", "b"] };
    const { result, output } = captureStdout(async () =>
      writeEnvelope(payload, "validate-result", { format: "yaml", store, schemas }),
    );
    await result;

    const out = output.join("");
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain(`type: ${schemas.outputs["validate-result"]}`);
    expect(out).toContain("value:");
    expect(out).toContain("valid: false");
    // type must precede value
    expect(out.indexOf("type:")).toBeLessThan(out.indexOf("value:"));
  });
});

describe("writeEnvelope — raw-json format", () => {
  test("emits bare value JSON without envelope (legacy 0.5.0 shape)", async () => {
    const payload = { valid: true, errors: [] };
    const { result, output } = captureStdout(async () =>
      writeEnvelope(payload, "validate-result", { format: "raw-json", store, schemas }),
    );
    await result;

    const out = output.join("");
    expect(out.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ valid: true, errors: [] });
    // Must NOT contain envelope keys
    expect(parsed.type).toBeUndefined();
    expect(parsed.value).toBeUndefined();
  });
});

describe("writeEnvelope — raw-yaml format", () => {
  test("emits bare value YAML without envelope (legacy 0.5.0 shape)", async () => {
    const payload = { valid: true, errors: [] };
    const { result, output } = captureStdout(async () =>
      writeEnvelope(payload, "validate-result", { format: "raw-yaml", store, schemas }),
    );
    await result;

    const out = output.join("");
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain("valid: true");
    expect(out).toContain("errors:");
    expect(out).not.toContain("type:");
    expect(out).not.toContain("value:");
  });
});

describe("writeEnvelope — text format (Liquid template)", () => {
  test("renders validate-result valid case as `✓ valid`", async () => {
    const payload = { valid: true, errors: [] };
    const { result, output } = captureStdout(async () =>
      writeEnvelope(payload, "validate-result", { format: "text", store, schemas }),
    );
    await result;

    const out = output.join("");
    expect(out.trim()).toBe("✓ valid");
  });

  test("renders validate-result invalid case with bulleted errors", async () => {
    const payload = {
      valid: false,
      errors: ['unknown role "bogus"', "$START missing resume edge"],
    };
    const { result, output } = captureStdout(async () =>
      writeEnvelope(payload, "validate-result", { format: "text", store, schemas }),
    );
    await result;

    const out = output.join("");
    expect(out).toContain("✗ invalid (2 errors)");
    expect(out).toContain('  - unknown role "bogus"');
    expect(out).toContain("  - $START missing resume edge");
  });
});

describe("writeEnvelope — schema lookup", () => {
  test("throws when schema short name is unknown", async () => {
    await expect(
      // @ts-expect-error invalid schema name on purpose
      writeEnvelope({}, "not-a-real-schema", { format: "json", store, schemas }),
    ).rejects.toThrow(/output schema not registered/);
  });

  test("each format calls in to the same registered schema hash", async () => {
    const payload = { valid: true, errors: [] };
    const formats: OutputFormat[] = ["json", "yaml"];
    for (const fmt of formats) {
      const { result, output } = captureStdout(async () =>
        writeEnvelope(payload, "validate-result", { format: fmt, store, schemas }),
      );
      await result;
      const out = output.join("");
      expect(out).toContain(schemas.outputs["validate-result"]);
    }
  });
});
