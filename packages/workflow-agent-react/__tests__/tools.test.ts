import { describe, test, expect, afterAll } from "bun:test";
import { readFileTool, writeFileTool, patchFileTool, shellExecTool } from "../src/tools/index.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const TMP_DIR = join(tmpdir(), `tools-test-${randomBytes(4).toString("hex")}`);
mkdirSync(TMP_DIR, { recursive: true });

const tmpFile = (name: string) => join(TMP_DIR, name);

const cleanupFiles: string[] = [];

afterAll(() => {
  for (const f of cleanupFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  try { unlinkSync(TMP_DIR); } catch { /* ignore */ }
});

describe("read_file", () => {
  test("reads file with line numbers", async () => {
    const p = tmpFile("read-test.txt");
    cleanupFiles.push(p);
    const content = "line1\nline2\nline3\n";
    require("node:fs").writeFileSync(p, content);

    const result = await readFileTool.handler(JSON.stringify({ path: p, offset: null, limit: null }));
    expect(result).toContain("1|line1");
    expect(result).toContain("2|line2");
    expect(result).toContain("3|line3");
  });

  test("reads with offset and limit", async () => {
    const p = tmpFile("read-test2.txt");
    cleanupFiles.push(p);
    require("node:fs").writeFileSync(p, "a\nb\nc\nd\ne\n");

    const result = await readFileTool.handler(JSON.stringify({ path: p, offset: 2, limit: 2 }));
    expect(result).toBe("2|b\n3|c");
  });

  test("returns error for missing file", async () => {
    const result = await readFileTool.handler(JSON.stringify({ path: "/nonexistent/file.txt", offset: null, limit: null }));
    expect(result).toContain("Error:");
  });
});

describe("write_file", () => {
  test("writes file and creates dirs", async () => {
    const p = tmpFile("sub/write-test.txt");
    cleanupFiles.push(p);

    const result = await writeFileTool.handler(JSON.stringify({ path: p, content: "hello world" }));
    expect(result).toContain("11 bytes");
    expect(readFileSync(p, "utf-8")).toBe("hello world");
  });
});

describe("patch_file", () => {
  test("patches file content", async () => {
    const p = tmpFile("patch-test.txt");
    cleanupFiles.push(p);
    require("node:fs").writeFileSync(p, "foo bar baz");

    const result = await patchFileTool.handler(JSON.stringify({ path: p, old_string: "bar", new_string: "qux" }));
    expect(result).toContain("Successfully");
    expect(readFileSync(p, "utf-8")).toBe("foo qux baz");
  });

  test("errors on not found", async () => {
    const p = tmpFile("patch-test2.txt");
    cleanupFiles.push(p);
    require("node:fs").writeFileSync(p, "foo");

    const result = await patchFileTool.handler(JSON.stringify({ path: p, old_string: "xyz", new_string: "abc" }));
    expect(result).toContain("not found");
  });

  test("errors on non-unique match", async () => {
    const p = tmpFile("patch-test3.txt");
    cleanupFiles.push(p);
    require("node:fs").writeFileSync(p, "aaa bbb aaa");

    const result = await patchFileTool.handler(JSON.stringify({ path: p, old_string: "aaa", new_string: "ccc" }));
    expect(result).toContain("not unique");
  });
});

describe("shell_exec", () => {
  test("runs echo", async () => {
    const result = await shellExecTool.handler(JSON.stringify({ command: "echo hello", timeout: null }));
    expect(result.trim()).toBe("hello");
  });

  test("handles timeout", async () => {
    const result = await shellExecTool.handler(JSON.stringify({ command: "sleep 10", timeout: 1 }));
    expect(result).toContain("timed out");
  });
});
