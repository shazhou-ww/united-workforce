import { describe, expect, it } from "vitest";
import { generateWorkflowAuthoringReference } from "../src/index.js";

// Helper: extract the contents of a fenced markdown block introduced by a heading.
// `heading` is matched literally (e.g. "**Multi-exit (oneOf)**") and we return
// the body of the next ```yaml fence that appears after it.
function extractYamlBlockAfterHeading(reference: string, heading: string): string {
  const headingIndex = reference.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error(`Heading not found: ${heading}`);
  }
  const tail = reference.slice(headingIndex);
  const fenceMatch = tail.match(/```yaml\n([\s\S]*?)```/);
  if (fenceMatch === null) {
    throw new Error(`No fenced yaml block found after heading: ${heading}`);
  }
  return fenceMatch[1];
}

// Helper: collect all fenced ```yaml blocks in a string.
function collectAllYamlBlocks(reference: string): string[] {
  const blocks: string[] = [];
  const re = /```yaml\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = re.exec(reference);
  while (match !== null) {
    blocks.push(match[1]);
    match = re.exec(reference);
  }
  return blocks;
}

// Helper: locate "frontmatter:" sub-blocks inside a yaml block. Returns each
// captured frontmatter sub-block's text (the lines indented under it).
function extractFrontmatterSubBlocks(yamlBlock: string): string[] {
  const lines = yamlBlock.split("\n");
  const blocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fmMatch = line.match(/^(\s*)frontmatter:\s*$/);
    if (fmMatch === null) continue;

    const baseIndent = fmMatch[1].length;
    const subLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      // Stop at a line indented at or below the frontmatter base indent
      // (and that has actual content — blank lines are part of the block).
      if (next.trim().length === 0) {
        subLines.push(next);
        continue;
      }
      const leading = next.length - next.trimStart().length;
      if (leading <= baseIndent) break;
      subLines.push(next);
    }
    blocks.push(subLines.join("\n"));
  }

  return blocks;
}

// Helper: assert a frontmatter sub-block obeys the schema rule:
// - oneOf shape → no sibling `type: object`
// - flat shape (type/properties at top) → `type: object` present
function assertFrontmatterRule(fm: string): void {
  const trimmed = fm.replace(/^\s+/, "");
  if (/^oneOf:/.test(trimmed)) {
    expect(fm).not.toMatch(/^\s+type:\s*object/m);
    return;
  }
  if (/^type:/.test(trimmed) || /^properties:/.test(trimmed)) {
    expect(fm).toMatch(/type:\s*object/);
  }
}

describe("generateWorkflowAuthoringReference", () => {
  const reference = generateWorkflowAuthoringReference();

  // ── Group 1 — `oneOf` example block (multi-exit) ───────────────────────────

  describe("multi-exit (oneOf) example", () => {
    it("does not contain sibling type: object next to oneOf", () => {
      const block = extractYamlBlockAfterHeading(reference, "**Multi-exit (oneOf)**");
      // The example must START with `frontmatter:` followed directly by `  oneOf:`
      // — no `type: object` in between.
      expect(block).toMatch(/^frontmatter:\n\s+oneOf:/);
      // And must NOT contain `type: object` followed by `oneOf:` as siblings.
      expect(block).not.toMatch(/type:\s*object\s*\n\s+oneOf:/);
    });

    it("variants are self-contained with their own properties and required", () => {
      const block = extractYamlBlockAfterHeading(reference, "**Multi-exit (oneOf)**");
      const propertiesCount = (block.match(/properties:/g) ?? []).length;
      const requiredCount = (block.match(/required:/g) ?? []).length;
      expect(propertiesCount).toBeGreaterThanOrEqual(2);
      expect(requiredCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Group 2 — Flat (single-exit) example block ─────────────────────────────

  describe("single-exit (flat schema) example", () => {
    it("retains `type: object` as a sibling of properties", () => {
      const block = extractYamlBlockAfterHeading(reference, "**Single-exit (flat schema)**");
      expect(block).toMatch(/type:\s*object/);
      expect(block).toMatch(/properties:/);
      expect(block).not.toMatch(/oneOf:/);
    });
  });

  // ── Group 3 — "Important rules" bullet ─────────────────────────────────────

  describe("important rules bullet", () => {
    it("no longer claims type: object is required for both flat and oneOf", () => {
      // The old wording — must be gone:
      expect(reference).not.toMatch(
        /`type:\s*object`\s+is\s+\*\*required\*\*\s+at\s+the\s+top\s+level\s+of\s+frontmatter\s+\(both\s+flat\s+and\s+oneOf\)/,
      );
    });

    it("provides accurate guidance about top-level type: object", () => {
      // It should still mention that `type: object` is the right shape for flat schemas
      // OR explicitly call out that `oneOf` should not have a sibling `type: object`.
      const flatGuidance = /flat\s+schema/i.test(reference);
      const oneOfGuidance = /oneOf/i.test(reference);
      expect(flatGuidance && oneOfGuidance).toBe(true);
    });
  });

  // ── Group 4 — Cross-cwd "cloner / developer" example block ────────────────

  describe("cross-repo dispatch example", () => {
    // Scope all checks to the "Cross-repo dispatch example" section.
    function getCrossRepoSection(): string {
      const headingIdx = reference.indexOf("Cross-repo dispatch example");
      expect(headingIdx).toBeGreaterThan(-1);
      // Slice up to the next "###" or "##" heading.
      const tail = reference.slice(headingIdx);
      const nextHeading = tail.search(/\n#{2,}\s/);
      return nextHeading === -1 ? tail : tail.slice(0, nextHeading);
    }

    it("cloner role uses correct flat shape (type: object + properties)", () => {
      const section = getCrossRepoSection();
      const clonerIdx = section.indexOf("cloner:\n");
      expect(clonerIdx).toBeGreaterThan(-1);
      const window = section.slice(clonerIdx, clonerIdx + 800);
      expect(window).toMatch(/frontmatter:\s*\n\s+type:\s*object\s*\n\s+properties:/);
    });

    it("developer role uses correct flat shape (type: object + properties)", () => {
      const section = getCrossRepoSection();
      const devIdx = section.indexOf("developer:\n");
      expect(devIdx).toBeGreaterThan(-1);
      const window = section.slice(devIdx, devIdx + 800);
      expect(window).toMatch(/frontmatter:\s*\n\s+type:\s*object\s*\n\s+properties:/);
    });
  });

  // ── Group 5 — Suspend planner example block ────────────────────────────────

  describe("suspend planner example", () => {
    it("retains type: object + properties (flat schema)", () => {
      // Find the planner role under the Suspend example section.
      const suspendIdx = reference.indexOf("## Suspend");
      expect(suspendIdx).toBeGreaterThan(-1);
      const suspendSection = reference.slice(suspendIdx);
      const plannerIdx = suspendSection.indexOf("planner:");
      expect(plannerIdx).toBeGreaterThan(-1);
      const window = suspendSection.slice(plannerIdx, plannerIdx + 600);
      expect(window).toMatch(/frontmatter:\s*\n\s+type:\s*object\s*\n\s+properties:/);
    });
  });

  // ── Group 6 — Output stability / format invariants ────────────────────────

  describe("output stability", () => {
    it("starts with the expected YAML frontmatter header", () => {
      expect(reference.startsWith("---\nname: uwf-workflow-authoring")).toBe(true);
    });

    it("is non-trivial in length", () => {
      expect(reference.length).toBeGreaterThan(1000);
    });

    it("every fenced yaml block obeys the frontmatter schema rule", () => {
      const yamlBlocks = collectAllYamlBlocks(reference);
      expect(yamlBlocks.length).toBeGreaterThan(0);

      const allFrontmatterBlocks = yamlBlocks.flatMap(extractFrontmatterSubBlocks);
      for (const fm of allFrontmatterBlocks) {
        assertFrontmatterRule(fm);
      }
    });
  });
});
