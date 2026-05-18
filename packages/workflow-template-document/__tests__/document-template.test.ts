import { describe, expect, test } from "bun:test";
import { tableToModerator } from "@uncaged/workflow-protocol/moderator-table.js";
import { validateWorkflowDescriptor } from "@uncaged/workflow-register";
import { END, type ModeratorContext, type RoleStep, START } from "@uncaged/workflow-runtime";
import { buildDocumentDescriptor } from "../src/descriptor.js";
import { documentTable } from "../src/moderator.js";
import type { DifferMeta, WriterMeta } from "../src/roles/index.js";
import type { DocumentMeta } from "../src/roles.js";

const documentModerator = tableToModerator(documentTable);

function makeCtx(
  steps: ModeratorContext<DocumentMeta>["steps"],
): ModeratorContext<DocumentMeta> {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    bundleHash: "TESTHASH00001",
    start: { role: START, content: "", meta: {}, timestamp: 0, parentState: null },
    steps,
  };
}

function writerGenerateStep(): RoleStep<DocumentMeta> {
  return {
    role: "writer",
    contentHash: "STUBHASHWRITER001",
    meta: { mode: "generate", outputDocx: "/out/output.docx", sourceDocx: null } satisfies WriterMeta,
    refs: [],
    timestamp: 1,
  };
}

function writerEditStep(): RoleStep<DocumentMeta> {
  return {
    role: "writer",
    contentHash: "STUBHASHWRITER002",
    meta: { mode: "edit", outputDocx: "/out/modified.docx", sourceDocx: "/out/original.docx" } satisfies WriterMeta,
    refs: [],
    timestamp: 1,
  };
}

function differStep(): RoleStep<DocumentMeta> {
  return {
    role: "differ",
    contentHash: "STUBHASHDIFF001",
    meta: {
      sourceDocx: "/out/original.docx",
      modifiedDocx: "/out/modified.docx",
      diffDocx: "/out/diff.docx",
    } satisfies DifferMeta,
    refs: [],
    timestamp: 2,
  };
}

describe("documentTable", () => {
  test("START → writer", () => {
    expect(documentModerator(makeCtx([]))).toBe("writer");
  });

  test("writer (generate) → END", () => {
    expect(documentModerator(makeCtx([writerGenerateStep()]))).toBe(END);
  });

  test("writer (edit) → differ", () => {
    expect(documentModerator(makeCtx([writerEditStep()]))).toBe("differ");
  });

  test("differ → END", () => {
    expect(documentModerator(makeCtx([writerEditStep(), differStep()]))).toBe(END);
  });
});

describe("buildDocumentDescriptor", () => {
  test("descriptor passes validation", () => {
    const descriptor = buildDocumentDescriptor();
    expect(() => validateWorkflowDescriptor(descriptor)).not.toThrow();
  });

  test("descriptor has writer and differ roles", () => {
    const descriptor = buildDocumentDescriptor();
    expect(Object.keys(descriptor.roles)).toContain("writer");
    expect(Object.keys(descriptor.roles)).toContain("differ");
  });
});
