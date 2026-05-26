import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cmdSetup, validateModel } from "../commands/setup.js";

describe("validateModel", () => {
  const BASE_URL = "https://api.example.com/v1";
  const API_KEY = "sk-test-key";
  const MODEL = "test-model";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("success path — returns ok on 200", async () => {
    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const result = await validateModel(BASE_URL, API_KEY, MODEL);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/chat/completions`);
    expect((opts as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }),
    );
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body).toEqual({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
  });

  test("HTTP 401 — returns error containing 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    const result = await validateModel(BASE_URL, API_KEY, MODEL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("401");
    }
  });

  test("HTTP 404 — returns error containing 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    const result = await validateModel(BASE_URL, API_KEY, MODEL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("404");
    }
  });

  test("network timeout — returns error mentioning timeout", async () => {
    const err = new DOMException("signal timed out", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(err);

    const result = await validateModel(BASE_URL, API_KEY, MODEL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toMatch(/timeout|timed out/);
    }
  });

  test("network error (DNS/connection) — returns error mentioning connectivity", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const result = await validateModel(BASE_URL, API_KEY, MODEL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toMatch(/connect|reach|network/);
    }
  });

  test("request body correctness", async () => {
    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await validateModel(BASE_URL, API_KEY, "my-special-model");

    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      model: "my-special-model",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
  });
});

describe("cmdSetup with validation", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "uwf-setup-validate-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const setupArgs = () => ({
    provider: "testprovider",
    baseUrl: "https://api.test.com/v1",
    apiKey: "sk-test",
    model: "test-model",
    storageRoot,
  });

  test("includes validation result on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const result = await cmdSetup(setupArgs());

    expect(result.validation).toEqual({ ok: true, value: undefined });
    // Config file should still be written
    expect(result.configPath).toBeTruthy();
  });

  test("includes validation failure — config still saved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    const result = await cmdSetup(setupArgs());

    expect(result.validation).toBeDefined();
    expect((result.validation as { ok: boolean }).ok).toBe(false);
    // Config file should still be written despite validation failure
    expect(result.configPath).toBeTruthy();
  });
});
