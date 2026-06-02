import { describe, expect, it } from "bun:test";
import type { AgentFrontmatter } from "../src/index.js";
import { parseFrontmatterMarkdown, validateFrontmatter } from "../src/index.js";

// ── parseFrontmatterMarkdown ─────────────────────────────────────────────────

describe("parseFrontmatterMarkdown", () => {
  describe("no frontmatter", () => {
    it("returns null frontmatter and full text as body when no fence", () => {
      const raw = "Just some markdown text.\n\n## Section\n\nContent.";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).toBeNull();
      expect(result.body).toBe(raw);
    });

    it("returns null frontmatter when --- appears mid-document", () => {
      const raw = "# Heading\n\n---\n\nContent.";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).toBeNull();
      expect(result.body).toBe(raw);
    });

    it("returns null frontmatter when opening fence is not followed by newline", () => {
      const raw = "--- inline content ---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).toBeNull();
      expect(result.body).toBe(raw);
    });

    it("returns null frontmatter when no closing fence", () => {
      const raw = "---\nstatus: done\nbody without close";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).toBeNull();
      expect(result.body).toBe(raw);
    });

    it("handles empty string", () => {
      const result = parseFrontmatterMarkdown("");
      expect(result.frontmatter).toBeNull();
      expect(result.body).toBe("");
    });
  });

  describe("status-only frontmatter", () => {
    it("parses status-only frontmatter", () => {
      const raw = "---\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).not.toBeNull();
      expect(result.frontmatter).toEqual({ status: "done" });
      expect(result.body).toBe("body");
    });

    it("strips leading newline from body", () => {
      const raw = "---\nstatus: done\n---\n\nbody here";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.body).toBe("body here");
    });

    it("body is empty string when nothing after closing fence", () => {
      const raw = "---\nstatus: done\n---\n";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.body).toBe("");
    });

    it("body is empty string when document ends exactly at closing fence", () => {
      const raw = "---\nstatus: done\n---";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.body).toBe("");
    });
  });

  describe("ignores legacy fields", () => {
    it("legacy fields next/confidence/artifacts/scope are NOT present on result", () => {
      const raw =
        "---\nstatus: done\nnext: reviewer\nconfidence: 0.9\nartifacts:\n  - src/foo.ts\nscope: thread\n---\n\nBody.";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).not.toBeNull();
      const fm = result.frontmatter!;
      expect(fm.status).toBe("done");
      // Legacy fields must not exist on the object at all
      expect("next" in fm).toBe(false);
      expect("confidence" in fm).toBe(false);
      expect("artifacts" in fm).toBe(false);
      expect("scope" in fm).toBe(false);
    });
  });

  describe("status field", () => {
    it.each([
      "done",
      "needs_input",
      "in_progress",
      "failed",
    ] as const)('parses status "%s"', (status) => {
      const raw = `---\nstatus: ${status}\n---\nbody`;
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.status).toBe(status);
    });

    it("returns null status for unknown value", () => {
      const raw = "---\nstatus: unknown_value\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.status).toBeNull();
    });

    it("returns null status when omitted", () => {
      const raw = "---\nfoo: bar\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.status).toBeNull();
    });
  });

  describe("unknown fields", () => {
    it("ignores unknown keys silently", () => {
      const raw = "---\nunknown_field: some_value\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.status).toBe("done");
      expect(Object.keys(result.frontmatter!)).toEqual(["status"]);
    });
  });

  describe("YAML comments", () => {
    it("ignores YAML comment lines", () => {
      const raw = "---\n# this is a comment\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.status).toBe("done");
    });
  });

  describe("empty frontmatter block", () => {
    it("parses empty frontmatter with status null", () => {
      const raw = "---\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).not.toBeNull();
      const fm = result.frontmatter!;
      expect(fm.status).toBeNull();
      expect(Object.keys(fm)).toEqual(["status"]);
      expect(result.body).toBe("body");
    });
  });

  describe("AgentFrontmatter has exactly one field", () => {
    it("has only status key", () => {
      const fm: AgentFrontmatter = { status: null };
      expect(Object.keys(fm)).toEqual(["status"]);
    });
  });

  describe("FrontmatterValidationError only has status variant", () => {
    it("status variant is valid", () => {
      const err: import("../src/index.js").FrontmatterValidationError = {
        field: "status",
        message: "test",
      };
      expect(err.field).toBe("status");
    });
  });
});

// ── validateFrontmatter ──────────────────────────────────────────────────────

describe("validateFrontmatter", () => {
  it("returns no errors for a valid status", () => {
    const errors = validateFrontmatter({ status: "done" });
    expect(errors).toHaveLength(0);
  });

  it("returns no errors when status is null", () => {
    const errors = validateFrontmatter({ status: null });
    expect(errors).toHaveLength(0);
  });

  it("returns error for invalid status", () => {
    const errors = validateFrontmatter({ status: "bogus" as never });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("status");
  });

  it("no validation for next/confidence/artifacts/scope — fields do not exist", () => {
    // AgentFrontmatter only has status — verify at runtime
    const fm: AgentFrontmatter = { status: "done" };
    expect(Object.keys(fm)).toEqual(["status"]);
    expect(validateFrontmatter(fm)).toHaveLength(0);
  });
});
