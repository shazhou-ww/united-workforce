import type {
  AdapterFn,
  RoleResult,
  ThreadContext,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import { createLogger } from "@uncaged/workflow-util";
import type * as z from "zod/v4";
import { editDocument, generateDocument } from "./runner.js";
import type { OfficeAgentConfig } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

type ParsedInput = { prompt: string; inputDocx: string | null };

function parseStartInput(content: string): ParsedInput {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.prompt === "string") {
      return {
        prompt: parsed.prompt,
        inputDocx: typeof parsed.inputDocx === "string" ? parsed.inputDocx : null,
      };
    }
  } catch {
    // not JSON — treat whole content as prompt, generate mode
  }
  return { prompt: content, inputDocx: null };
}

export function createOfficeAgent(config: OfficeAgentConfig): AdapterFn {
  return <T>(_systemPrompt: string, schema: z.ZodType<T>) =>
    async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const { prompt, inputDocx } = parseStartInput(ctx.start.content);
      log(
        "8FQKP3NV",
        `office-agent: mode=${inputDocx === null ? "generate" : "edit"} thread=${ctx.threadId}`,
      );

      let raw: string;
      if (inputDocx === null) {
        const result = await generateDocument(config, ctx.threadId, prompt);
        raw = JSON.stringify({ mode: "generate", outputDocx: result.outputDocx, sourceDocx: null });
      } else {
        const result = await editDocument(config, ctx.threadId, prompt, inputDocx);
        raw = JSON.stringify({
          mode: "edit",
          outputDocx: result.outputDocx,
          sourceDocx: result.sourceDocx,
        });
      }

      const meta = schema.parse(JSON.parse(raw)) as T;
      return { meta, childThread: null };
    };
}
