import { describe, expect, it } from "vitest";
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

  describe("full frontmatter document", () => {
    it("parses all fields from a well-formed document", () => {
      const raw = `---
status: done
next: reviewer
confidence: 0.9
artifacts:
  - src/foo.ts
  - src/bar.ts
scope: thread
---

## Summary

Everything looks good.`;

      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).not.toBeNull();
      const fm = result.frontmatter!;
      expect(fm.status).toBe("done");
      expect(fm.next).toBe("reviewer");
      expect(fm.confidence).toBe(0.9);
      expect(fm.artifacts).toEqual(["src/foo.ts", "src/bar.ts"]);
      expect(fm.scope).toBe("thread");
      expect(result.body).toBe("## Summary\n\nEverything looks good.");
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
      const raw = "---\nconfidence: 0.5\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.status).toBeNull();
    });
  });

  describe("confidence field", () => {
    it("parses integer as number", () => {
      const raw = "---\nconfidence: 1\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.confidence).toBe(1);
    });

    it("parses decimal", () => {
      const raw = "---\nconfidence: 0.75\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.confidence).toBe(0.75);
    });

    it("returns null when omitted", () => {
      const raw = "---\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.confidence).toBeNull();
    });

    it("returns null for non-numeric value", () => {
      const raw = "---\nconfidence: high\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.confidence).toBeNull();
    });
  });

  describe("artifacts field", () => {
    it("parses block sequence", () => {
      const raw = "---\nartifacts:\n  - a.ts\n  - b.ts\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.artifacts).toEqual(["a.ts", "b.ts"]);
    });

    it("parses inline sequence", () => {
      const raw = "---\nartifacts: [a.ts, b.ts]\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.artifacts).toEqual(["a.ts", "b.ts"]);
    });

    it("returns empty array when omitted", () => {
      const raw = "---\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.artifacts).toEqual([]);
    });

    it("wraps single scalar in array", () => {
      const raw = "---\nartifacts: only-one.ts\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.artifacts).toEqual(["only-one.ts"]);
    });
  });

  describe("scope field", () => {
    it('parses scope "role"', () => {
      const raw = "---\nscope: role\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.scope).toBe("role");
    });

    it('parses scope "thread"', () => {
      const raw = "---\nscope: thread\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.scope).toBe("thread");
    });

    it('defaults to "role" when omitted', () => {
      const raw = "---\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.scope).toBe("role");
    });

    it('defaults to "role" for unknown scope value', () => {
      const raw = "---\nscope: global\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.scope).toBe("role");
    });
  });

  describe("next field", () => {
    it("parses a role name", () => {
      const raw = "---\nnext: planner\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.next).toBe("planner");
    });

    it("returns null when omitted", () => {
      const raw = "---\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.next).toBeNull();
    });
  });

  describe("unknown fields", () => {
    it("ignores unknown keys silently", () => {
      const raw = "---\nunknown_field: some_value\nstatus: done\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter?.status).toBe("done");
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
    it("parses empty frontmatter and uses all defaults", () => {
      const raw = "---\n---\nbody";
      const result = parseFrontmatterMarkdown(raw);
      expect(result.frontmatter).not.toBeNull();
      const fm = result.frontmatter!;
      expect(fm.status).toBeNull();
      expect(fm.next).toBeNull();
      expect(fm.confidence).toBeNull();
      expect(fm.artifacts).toEqual([]);
      expect(fm.scope).toBe("role");
      expect(result.body).toBe("body");
    });
  });
});

// ── validateFrontmatter ──────────────────────────────────────────────────────

function validFm(overrides: Partial<AgentFrontmatter> = {}): AgentFrontmatter {
  return {
    status: "done",
    next: null,
    confidence: null,
    artifacts: [],
    scope: "role",
    ...overrides,
  };
}

describe("validateFrontmatter", () => {
  it("returns no errors for a fully valid frontmatter", () => {
    const errors = validateFrontmatter(validFm());
    expect(errors).toHaveLength(0);
  });

  it("returns no errors when all nullable fields are null", () => {
    const fm: AgentFrontmatter = {
      status: null,
      next: null,
      confidence: null,
      artifacts: [],
      scope: "role",
    };
    expect(validateFrontmatter(fm)).toHaveLength(0);
  });

  describe("confidence validation", () => {
    it("accepts 0.0", () => {
      expect(validateFrontmatter(validFm({ confidence: 0 }))).toHaveLength(0);
    });

    it("accepts 1.0", () => {
      expect(validateFrontmatter(validFm({ confidence: 1 }))).toHaveLength(0);
    });

    it("rejects value below 0", () => {
      const errors = validateFrontmatter(validFm({ confidence: -0.1 }));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("confidence");
    });

    it("rejects value above 1", () => {
      const errors = validateFrontmatter(validFm({ confidence: 1.01 }));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("confidence");
    });
  });

  describe("next validation", () => {
    it("accepts a simple role name", () => {
      expect(validateFrontmatter(validFm({ next: "reviewer" }))).toHaveLength(0);
    });

    it("accepts kebab-case role name", () => {
      expect(validateFrontmatter(validFm({ next: "code-reviewer" }))).toHaveLength(0);
    });

    it("rejects role name with whitespace", () => {
      const errors = validateFrontmatter(validFm({ next: "role name" }));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("next");
    });
  });

  describe("artifacts validation", () => {
    it("accepts non-empty path strings", () => {
      expect(
        validateFrontmatter(validFm({ artifacts: ["src/foo.ts", "src/bar.ts"] })),
      ).toHaveLength(0);
    });

    it("rejects empty string artifact entries", () => {
      const errors = validateFrontmatter(validFm({ artifacts: [""] }));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("artifacts");
    });

    it("rejects whitespace-only artifact entries", () => {
      const errors = validateFrontmatter(validFm({ artifacts: ["   "] }));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("artifacts");
    });
  });

  describe("multiple errors", () => {
    it("reports multiple violations at once", () => {
      const fm: AgentFrontmatter = {
        status: "done",
        next: "bad role",
        confidence: 2,
        artifacts: [""],
        scope: "role",
      };
      const errors = validateFrontmatter(fm);
      const fields = errors.map((e) => e.field);
      expect(fields).toContain("next");
      expect(fields).toContain("confidence");
      expect(fields).toContain("artifacts");
    });
  });
});
