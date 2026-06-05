import { describe, expect, test } from "vitest";
import { evaluate } from "../evaluate.js";
import { isSuspendResult } from "../types.js";

describe("Edge prompt template variable resolution", () => {
  test("returns error when rendered prompt is empty string", () => {
    const graph = {
      $START: {
        new: { role: "classifier", prompt: "{{{userPrompt}}}", location: null },
      },
    };

    const result = evaluate(graph, "$START", { $status: "new" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("prompt");
      expect(result.error.message).toContain("empty");
    }
  });

  test("returns error when rendered prompt is whitespace-only", () => {
    const graph = {
      $START: {
        new: { role: "classifier", prompt: "  {{{userPrompt}}}  ", location: null },
      },
    };

    const result = evaluate(graph, "$START", { $status: "new" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("prompt");
      expect(result.error.message).toContain("empty");
    }
  });

  test("succeeds when all template variables resolve to non-empty values", () => {
    const graph = {
      $START: {
        new: { role: "classifier", prompt: "{{{userPrompt}}}", location: null },
      },
    };

    const result = evaluate(graph, "$START", { $status: "new", userPrompt: "Fix the bug" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toBe("Fix the bug");
    }
  });

  test("succeeds with static (no-variable) prompt", () => {
    const graph = {
      $START: {
        new: { role: "classifier", prompt: "Classify this input", location: null },
      },
    };

    const result = evaluate(graph, "$START", { $status: "new" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toBe("Classify this input");
    }
  });

  test("succeeds when prompt has mix of static text and unresolved variables", () => {
    const graph = {
      $START: {
        new: { role: "classifier", prompt: "Please handle: {{{userPrompt}}}", location: null },
      },
    };

    const result = evaluate(graph, "$START", { $status: "new" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toBe("Please handle: ");
    }
  });

  test("returns error when ALL variables missing and no static text remains", () => {
    const graph = {
      $START: {
        new: { role: "classifier", prompt: "{{{a}}}{{{b}}}", location: null },
      },
    };

    const result = evaluate(graph, "$START", { $status: "new" });

    expect(result.ok).toBe(false);
  });
});

describe("Moderator location resolution", () => {
  test("returns null location when edge has no location field", () => {
    const graph = {
      planner: {
        ready: {
          role: "coder",
          prompt: "Implement the code",
          location: null,
        },
      },
    };

    const result = evaluate(graph, "planner", { $status: "ready" });

    expect(result.ok).toBe(true);
    if (result.ok && !isSuspendResult(result.value)) {
      expect(result.value.location).toBe(null);
    }
  });

  test("resolves static location string", () => {
    const graph = {
      planner: {
        ready: {
          role: "coder",
          prompt: "Implement the code",
          location: "/static/path",
        },
      },
    };

    const result = evaluate(graph, "planner", { $status: "ready" });

    expect(result.ok).toBe(true);
    if (result.ok && !isSuspendResult(result.value)) {
      expect(result.value.location).toBe("/static/path");
    }
  });

  test("resolves mustache template location", () => {
    const graph = {
      planner: {
        ready: {
          role: "coder",
          prompt: "Implement the code",
          location: "{{{repoPath}}}",
        },
      },
    };

    const result = evaluate(graph, "planner", {
      $status: "ready",
      repoPath: "/home/user/repo",
    });

    expect(result.ok).toBe(true);
    if (result.ok && !isSuspendResult(result.value)) {
      expect(result.value.location).toBe("/home/user/repo");
    }
  });

  test("resolves mustache template with multiple variables", () => {
    const graph = {
      planner: {
        ready: {
          role: "coder",
          prompt: "Implement the code",
          location: "{{{basePath}}}/{{{projectName}}}",
        },
      },
    };

    const result = evaluate(graph, "planner", {
      $status: "ready",
      basePath: "/home/user",
      projectName: "myproject",
    });

    expect(result.ok).toBe(true);
    if (result.ok && !isSuspendResult(result.value)) {
      expect(result.value.location).toBe("/home/user/myproject");
    }
  });

  test("handles missing template variable gracefully", () => {
    const graph = {
      planner: {
        ready: {
          role: "coder",
          prompt: "Implement the code",
          location: "{{{repoPath}}}",
        },
      },
    };

    const result = evaluate(graph, "planner", { $status: "ready" });

    expect(result.ok).toBe(true);
    if (result.ok && !isSuspendResult(result.value)) {
      // Mustache renders missing variables as empty string
      expect(result.value.location).toBe("");
    }
  });
});
