import type { Hash, Store } from "@ocas/core";
import type { OutputSchemaName } from "@united-workforce/protocol";
import { Liquid } from "liquidjs";
import { stringify } from "yaml";
import type { UwfSchemaHashes } from "./schemas.js";
import {
  renderStepList,
  renderStepShow,
  renderThreadCancel,
  renderThreadList,
  renderThreadShow,
  renderThreadStart,
  renderWorkflowList,
  renderWorkflowShow,
} from "./text-renderers.js";

/**
 * Five output formats supported by the uwf CLI. `text` is the default and
 * produces a Liquid-rendered human-readable view. `json` and `yaml` wrap the
 * payload in an ocas envelope `{ type, value }` for self-describing output.
 * `raw-json` and `raw-yaml` emit the bare value, preserving 0.5.0 byte-for-byte
 * output for backward-compat consumers.
 */
export type OutputFormat = "text" | "json" | "yaml" | "raw-json" | "raw-yaml";

export const SUPPORTED_FORMATS: readonly OutputFormat[] = [
  "text",
  "json",
  "yaml",
  "raw-json",
  "raw-yaml",
];

export function isOutputFormat(v: string): v is OutputFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(v);
}

/**
 * Per-command text renderer registry. Maps a fully-qualified command path
 * (e.g. `"thread list"`, `"workflow show"`) to a function that converts
 * the command's payload into a human-readable string.
 *
 * Renderers must:
 * - Always return a `string` (never `undefined`).
 * - Tolerate missing/null fields without throwing.
 *
 * The Liquid template path inside `writeEnvelope` is the primary rendering
 * implementation. This registry exists so callers without a CAS store
 * (tests, library consumers) can resolve `text` rendering, and so
 * `formatOutput(data, "text", commandPath)` returns a meaningful string.
 */
export type TextRenderer = (data: unknown) => string;

export const TEXT_RENDERERS: Record<string, TextRenderer> = {
  "thread list": renderThreadList,
  "thread show": renderThreadShow,
  "thread start": renderThreadStart,
  "thread cancel": renderThreadCancel,
  "workflow list": renderWorkflowList,
  "workflow show": renderWorkflowShow,
  "step list": renderStepList,
  "step show": renderStepShow,
};

/** Look up a registered text renderer by command path. */
export function getTextRenderer(commandPath: string): TextRenderer | undefined {
  return TEXT_RENDERERS[commandPath];
}

/** Register (or override) a text renderer for a command path. */
export function registerTextRenderer(commandPath: string, renderer: TextRenderer): void {
  TEXT_RENDERERS[commandPath] = renderer;
}

/**
 * Format a payload as a string in the requested output format.
 *
 * For `"text"`, `formatOutput` looks up the registered renderer for
 * `commandPath` (when provided) and falls back to a JSON serialization when
 * no renderer is registered. The result is always a `string` — never
 * `undefined`. For `"json"` and `"yaml"` the bare value is serialized.
 * For `"raw-json"` and `"raw-yaml"` the output is identical to `"json"` /
 * `"yaml"` (both modes emit the bare value; envelope wrapping happens in
 * `writeEnvelope`).
 *
 * Note: this is the legacy in-process formatter used by raw output paths
 * (`thread cancel`, `step fork`, `setup`, `log/config`) and tests. Production
 * commands with a registered output schema go through `writeEnvelope`.
 */
export function formatOutput(data: unknown, format: OutputFormat, commandPath?: string): string {
  switch (format) {
    case "json":
    case "raw-json":
      return JSON.stringify(data);
    case "yaml":
    case "raw-yaml":
      return stringify(data, { aliasDuplicateObjects: false }).trimEnd();
    case "text": {
      if (commandPath !== undefined) {
        const renderer = TEXT_RENDERERS[commandPath];
        if (renderer !== undefined) {
          return renderer(data);
        }
      }
      // Fallback: JSON pretty-printed so `formatOutput(_, "text")` never returns
      // `"undefined"` (the bug from issue #327).
      return JSON.stringify(data, null, 2);
    }
  }
}

const schemaHashCache = new Map<OutputSchemaName, Hash>();

/**
 * Resolve the CAS hash for an output schema by short name, caching the result
 * for the lifetime of the process.
 */
export function resolveOutputSchemaHash(
  outputs: Record<OutputSchemaName, Hash>,
  schemaName: OutputSchemaName,
): Hash {
  const cached = schemaHashCache.get(schemaName);
  if (cached !== undefined) return cached;
  const hash = outputs[schemaName];
  if (hash === undefined) {
    throw new Error(`output schema not registered: @uwf/output/${schemaName}`);
  }
  schemaHashCache.set(schemaName, hash);
  return hash;
}

export type WriteEnvelopeOptions = {
  format: OutputFormat;
  store: Store;
  schemas: UwfSchemaHashes;
};

/**
 * Wrap a CLI command payload in the chosen format and write it to stdout.
 *
 * - `text`     → Liquid template at `@ocas/template/text/<hash>` (fallback YAML envelope)
 * - `json`     → `{"type":<hash>,"value":<payload>}` (envelope JSON)
 * - `yaml`     → envelope as multi-line YAML
 * - `raw-json` → bare `<payload>` (legacy 0.5.0 shape)
 * - `raw-yaml` → bare `<payload>` (legacy 0.5.0 shape)
 */
export async function writeEnvelope(
  payload: unknown,
  schemaName: OutputSchemaName,
  options: WriteEnvelopeOptions,
): Promise<void> {
  const { format, store, schemas } = options;
  const schemaHash = resolveOutputSchemaHash(schemas.outputs, schemaName);

  let body: string;
  switch (format) {
    case "json":
      body = JSON.stringify({ type: schemaHash, value: payload });
      break;
    case "yaml":
      body = stringify(
        { type: schemaHash, value: payload },
        { aliasDuplicateObjects: false },
      ).trimEnd();
      break;
    case "raw-json":
      body = JSON.stringify(payload);
      break;
    case "raw-yaml":
      body = stringify(payload, { aliasDuplicateObjects: false }).trimEnd();
      break;
    case "text":
      body = await renderEnvelopeText(store, schemaHash, payload, schemaName);
      break;
  }

  process.stdout.write(`${body}\n`);
}

let liquidEngine: Liquid | null = null;

type GraphMap = Record<string, Record<string, { role?: string }>>;

function firstRole(graph: GraphMap, current: string): string | null {
  const transitions = graph[current];
  if (!transitions) return null;
  const firstKey = Object.keys(transitions)[0];
  if (firstKey === undefined) return null;
  const next = transitions[firstKey]?.role;
  return typeof next === "string" ? next : null;
}

function buildGraphPath(graph: GraphMap, start: string, limit: number): string[] {
  const out: string[] = [start];
  const seen = new Set<string>([start]);
  let cur = start;
  while (out.length < limit) {
    const next = firstRole(graph, cur);
    if (next === null || next === "$END") {
      out.push("$END");
      break;
    }
    if (seen.has(next)) break;
    seen.add(next);
    out.push(next);
    cur = next;
  }
  return out;
}

function getLiquidEngine(): Liquid {
  if (liquidEngine !== null) return liquidEngine;
  const engine = new Liquid({ cache: false, strictFilters: false, strictVariables: false });
  engine.registerFilter("keys", (input: unknown) =>
    input !== null && typeof input === "object" ? Object.keys(input as object) : [],
  );
  engine.registerFilter("graph_path", (graph: unknown, start: unknown, max: unknown): string[] => {
    if (graph === null || typeof graph !== "object") return [];
    const limit = typeof max === "number" ? max : 5;
    const startNode = typeof start === "string" ? start : "$START";
    return buildGraphPath(graph as GraphMap, startNode, limit);
  });
  liquidEngine = engine;
  return engine;
}

function readTemplateContent(store: Store, schemaHash: Hash): string | null {
  const varName = `@ocas/template/text/${schemaHash}`;
  const variable = store.var.get(varName);
  if (variable === null) return null;
  const node = store.cas.get(variable.value);
  if (node === null) return null;
  if (typeof node.payload !== "string") return null;
  return node.payload;
}

function buildLiquidContext(payload: unknown, schemaHash: Hash): Record<string, unknown> {
  const ctx: Record<string, unknown> = { payload, type: schemaHash };
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    for (const [k, v] of Object.entries(payload)) {
      if (k !== "payload" && k !== "type") {
        ctx[k] = v;
      }
    }
  }
  return ctx;
}

async function renderEnvelopeText(
  store: Store,
  schemaHash: Hash,
  payload: unknown,
  schemaName: OutputSchemaName,
): Promise<string> {
  const template = readTemplateContent(store, schemaHash);
  if (template === null) {
    process.stderr.write(
      `warning: missing text template for @uwf/output/${schemaName} (var @ocas/template/text/${schemaHash}); falling back to YAML\n`,
    );
    return stringify(
      { type: schemaHash, value: payload },
      { aliasDuplicateObjects: false },
    ).trimEnd();
  }
  try {
    const engine = getLiquidEngine();
    const context = buildLiquidContext(payload, schemaHash);
    const out = await engine.parseAndRender(template, context);
    return out.replace(/\n+$/, "");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `warning: failed to render text template for @uwf/output/${schemaName}: ${message}; falling back to YAML\n`,
    );
    return stringify(
      { type: schemaHash, value: payload },
      { aliasDuplicateObjects: false },
    ).trimEnd();
  }
}
