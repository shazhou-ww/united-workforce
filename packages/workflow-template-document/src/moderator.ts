import {
  END,
  type ModeratorCondition,
  type ModeratorTable,
  START,
} from "@uncaged/workflow-runtime";
import type { WriterMeta } from "./roles/writer.js";
import type { DocumentMeta } from "./roles.js";

const writerIsEditMode: ModeratorCondition<DocumentMeta> = {
  name: "writerIsEditMode",
  description: "Writer ran in edit mode and produced a modified document",
  check: (ctx) => {
    const writerStep = ctx.steps.find((s) => s.role === "writer");
    if (writerStep === undefined) return false;
    return (writerStep.meta as WriterMeta).mode === "edit";
  },
};

export const documentTable: ModeratorTable<DocumentMeta> = {
  [START]: [{ condition: "FALLBACK", role: "writer" }],
  writer: [
    { condition: writerIsEditMode, role: "differ" },
    { condition: "FALLBACK", role: END },
  ],
  differ: [{ condition: "FALLBACK", role: END }],
};
