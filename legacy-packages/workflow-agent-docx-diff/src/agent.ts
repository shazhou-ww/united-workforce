import * as z from "zod/v4";
import { dirname, join } from "node:path";
import type { AdapterFn, RoleResult, ThreadContext, WorkflowRuntime } from "@uncaged/workflow-runtime";
import type { WriterMeta } from "@uncaged/workflow-template-document";
import { runDocxDiff } from "./runner.js";
import type { DocxDiffAgentConfig } from "./types.js";

export function createDocxDiffAgent(config: DocxDiffAgentConfig): AdapterFn {
  return <T>(_prompt: string, schema: z.ZodType<T>) =>
    async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const writerStep = ctx.steps.find((s) => s.role === "writer");
      if (writerStep === undefined) throw new Error("differ: no writer step found");

      const writerMeta = writerStep.meta as WriterMeta;
      if (writerMeta.mode !== "edit")
        throw new Error("differ: writer did not run in edit mode");

      const diffDocx = join(dirname(writerMeta.outputDocx), "diff.docx");
      const raw = await runDocxDiff(
        config,
        writerMeta.sourceDocx,
        writerMeta.outputDocx,
        diffDocx,
      );

      const meta = schema.parse(JSON.parse(raw)) as T;
      return { meta, childThread: null };
    };
}
