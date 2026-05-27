import { describe, expect, test } from "vitest";
import { evaluate } from "../evaluate.js";

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
    if (result.ok) {
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
    if (result.ok) {
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
    if (result.ok) {
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
    if (result.ok) {
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
    if (result.ok) {
      // Mustache renders missing variables as empty string
      expect(result.value.location).toBe("");
    }
  });
});
