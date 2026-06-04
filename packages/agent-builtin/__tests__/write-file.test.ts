import { describe, it, expect, afterAll } from "vitest";
import { writeFileTool } from "../src/tools/write-file.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `write-file-test-${Date.now()}`);
const ctx = { cwd: testDir, storageRoot: testDir };

afterAll(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe("writeFileTool", () => {
	it("writes file successfully", async () => {
		const result = await writeFileTool.execute({ path: "out.txt", content: "hi" }, ctx);
		expect(result).toMatch(/Wrote 2 bytes/);
		const content = await readFile(join(testDir, "out.txt"), "utf8");
		expect(content).toBe("hi");
	});

	it("creates parent directories", async () => {
		const result = await writeFileTool.execute({ path: "a/b/c.txt", content: "nested" }, ctx);
		expect(result).toMatch(/Wrote/);
		const content = await readFile(join(testDir, "a/b/c.txt"), "utf8");
		expect(content).toBe("nested");
	});

	it("returns error when path is not a string", async () => {
		const result = await writeFileTool.execute({ path: 123, content: "x" }, ctx);
		expect(result).toBe("Error: path and content must be strings");
	});

	it("returns error when content is not a string", async () => {
		const result = await writeFileTool.execute({ path: "x.txt", content: 42 }, ctx);
		expect(result).toBe("Error: path and content must be strings");
	});

	it("returns error when args is null", async () => {
		const result = await writeFileTool.execute(null, ctx);
		expect(result).toBe("Error: path and content must be strings");
	});
});
