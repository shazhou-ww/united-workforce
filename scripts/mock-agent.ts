#!/usr/bin/env tsx
// Mock agent for smoke testing
import { bootstrap, type JSONSchema, putSchema } from "@ocas/core";
import { createAgent } from "../packages/uwf-agent-kit/src/index.js";

const MOCK_RAW_OUTPUT_SCHEMA: JSONSchema = {
  title: "mock-raw-output",
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string" },
  },
  additionalProperties: false,
};

const agent = createAgent({
  name: "mock",
  run: async (ctx) => {
    const output = `Mock output for role ${ctx.role}: task was "${ctx.start.prompt}"`;
    const { store } = ctx;
    await bootstrap(store);
    const schemaHash = await putSchema(store, MOCK_RAW_OUTPUT_SCHEMA);
    const detailHash = await store.put(schemaHash, { text: output });
    return { output, detailHash };
  },
});

await agent();
