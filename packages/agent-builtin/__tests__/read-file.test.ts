import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileTool } from "../src/tools/read-file.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `read-file-test-${Date.now()}`);
const ctx = { cwd: testDir, storageRoot: testDir };

beforeAll(async () => {
	await mkdir(testDir, { recursive: true });
	await writeFile(join(testDir, "hello.txt"), "hello world", "utf8");
});

afterAll(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe("readFileTool", () => {
	it("reads a file successfully", async () => {
		const result = await readFileTool.execute({ path: "hello.txt" }, ctx);
		expect(result).toBe("hello world");
	});

	it("returns error for non-existent file", async () => {
		const result = await readFileTool.execute({ path: "nope.txt" }, ctx);
		expect(result).toMatch(/^Error:/);
	});

	it("returns error for directory", async () => {
		const result = await readFileTool.execute({ path: "." }, ctx);
		expect(result).toBe("Error: not a file");
	});

	it("returns error when path is not a string", async () => {
		const result = await readFileTool.execute({ path: 123 }, ctx);
		expect(result).toBe("Error: path must be a string");
	});

	it("returns error when args is null", async () => {
		const result = await readFileTool.execute(null, ctx);
		expect(result).toBe("Error: path must be a string");
	});

	it("returns error for file exceeding 512KB limit", async () => {
		const bigFile = join(testDir, "big.txt");
		await writeFile(bigFile, Buffer.alloc(512 * 1024 + 1, 65));
		const result = await readFileTool.execute({ path: "big.txt" }, ctx);
		expect(result).toMatch(/Error:.*limit/);
	});
});
