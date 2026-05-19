import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasStore, putContentNodeWithRefs } from "@uncaged/workflow-cas";
import * as z from "zod/v4";

import { createExtract } from "../src/extract/extract-fn.js";

function installPlainJsonExtractMock(meta: Record<string, unknown>): () => void {
  const origFetch = globalThis.fetch;
  const mockFetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(meta) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  globalThis.fetch = Object.assign(mockFetch, {
    preconnect: origFetch.preconnect.bind(origFetch),
  }) as typeof fetch;
  return () => {
    globalThis.fetch = origFetch;
  };
}

describe("createExtract — ExtractResult shape", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("returns meta, contentPayload, and refs[]", async () => {
    restoreFetch = installPlainJsonExtractMock({ confidence: 0.9 });

    const dir = await mkdtemp(join(tmpdir(), "wf-extract-refs-"));
    try {
      const cas = createCasStore(join(dir, "cas"));
      const extract = createExtract(
        { baseUrl: "http://127.0.0.1:9", apiKey: "key", model: "m" },
        { cas },
      );

      const schema = z.object({ confidence: z.number() });
      const contentHash = await putContentNodeWithRefs(cas, "model says hello", []);

      const out = await extract(schema, contentHash);

      expect(out.meta).toEqual({ confidence: 0.9 });
      expect(out.contentPayload).toBe("model says hello");
      expect(Array.isArray(out.refs)).toBe(true);
      expect(out.refs).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
