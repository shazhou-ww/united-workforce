import { putContentNodeWithRefs } from "@uncaged/workflow-cas";
import type {
  AdapterFn,
  AgentFn,
  RoleResult,
  ThreadContext,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import {
  createLogger,
  parseFrontmatterMarkdown,
  validateFrontmatter,
} from "@uncaged/workflow-util";
import type * as z from "zod/v4";
import { buildOutputFormatInstruction } from "./build-output-format-instruction.js";

const log = createLogger({ sink: { kind: "stderr" } });

export type ExtractOptionsFn<Opt> = (
  ctx: ThreadContext,
  prompt: string,
  runtime: WorkflowRuntime,
) => Promise<Opt>;

/**
 * Try to satisfy `schema` from frontmatter fields alone.
 *
 * Returns the parsed value on success, or `null` when the frontmatter does not
 * cover all required fields of the schema.  Never throws.
 */
function tryFrontmatterMeta<T>(
  raw: string,
  schema: z.ZodType<T>,
): { meta: T; body: string } | null {
  const { frontmatter, body } = parseFrontmatterMarkdown(raw);

  if (frontmatter === null) {
    return null;
  }

  const validationErrors = validateFrontmatter(frontmatter);
  if (validationErrors.length > 0) {
    log(
      "4KNMR2PX",
      `frontmatter validation errors: ${validationErrors.map((e) => e.message).join("; ")}`,
    );
    return null;
  }

  // Coerce frontmatter into the plain object shape the schema expects.
  const candidate: Record<string, unknown> = {
    status: frontmatter.status,
    next: frontmatter.next,
    confidence: frontmatter.confidence,
    artifacts: frontmatter.artifacts,
    scope: frontmatter.scope,
  };

  const result = schema.safeParse(candidate);
  if (!result.success) {
    log("7BQST3VW", "frontmatter does not satisfy schema; falling back to extract");
    return null;
  }

  return { meta: result.data, body };
}

/**
 * Bridges {@link AgentFn} to {@link AdapterFn}.
 *
 * Happy path (zero LLM cost):
 *   1. extract(ctx, prompt, runtime) → Opt
 *   2. agent(ctx, options) → raw string
 *   3. Parse raw as frontmatter markdown
 *   4. If frontmatter is valid AND satisfies `schema` → use as meta directly
 *      CAS stores the body (without frontmatter block)
 *
 * Fallback (safety net):
 *   4b. Store full raw in CAS
 *   5b. runtime.extract(schema, contentHash) → typed meta via LLM
 */
export function createAgentAdapter<Opt>(
  agent: AgentFn<Opt>,
  extract: ExtractOptionsFn<Opt>,
): AdapterFn {
  return <T>(prompt: string, schema: z.ZodType<T>) => {
    const augmentedPrompt = `${buildOutputFormatInstruction(schema)}\n\n${prompt}`;
    return async (ctx: ThreadContext, runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const options = await extract(ctx, augmentedPrompt, runtime);
      const raw = await agent(ctx, options);

      const frontmatterResult = tryFrontmatterMeta(raw, schema);

      if (frontmatterResult !== null) {
        log("3VXPW8QR", "frontmatter satisfied schema — skipping LLM extract");
        await putContentNodeWithRefs(runtime.cas, frontmatterResult.body, []);
        return { meta: frontmatterResult.meta, childThread: null };
      }

      log("8MTNJ5YK", "no valid frontmatter — falling back to runtime.extract");
      const contentHash = await putContentNodeWithRefs(runtime.cas, raw, []);
      const extracted = await runtime.extract(
        schema as z.ZodType<Record<string, unknown>>,
        contentHash,
      );
      return { meta: extracted.meta as T, childThread: null };
    };
  };
}
