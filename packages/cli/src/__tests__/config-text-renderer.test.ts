import { describe, expect, test } from "vitest";
import { formatOutput } from "../format.js";

describe("config text renderers", () => {
  describe("config list", () => {
    test("renders flat key-value pairs in text format", () => {
      const data = {
        defaultAgent: "claude-code",
        agents: {
          hermes: {
            command: "uwf-hermes",
            args: [],
          },
          "claude-code": {
            command: "uwf-claude-code",
            args: [],
          },
        },
        concurrency: {
          maxRunning: 4,
        },
      };

      const result = formatOutput(data, "text", "config list");
      expect(result).toContain("defaultAgent");
      expect(result).toContain("claude-code");
      expect(result).toContain("agents.hermes.command");
      expect(result).toContain("uwf-hermes");
      expect(result).toContain("agents.hermes.args");
      expect(result).toContain("[]");
      expect(result).toContain("agents.claude-code.command");
      expect(result).toContain("uwf-claude-code");
      expect(result).toContain("concurrency.maxRunning");
      expect(result).toContain("4");
    });

    test("uses dot-notation for nested keys", () => {
      const data = {
        agents: {
          hermes: {
            command: "uwf-hermes",
          },
        },
      };

      const result = formatOutput(data, "text", "config list");
      expect(result).toContain("agents.hermes.command");
    });

    test("displays array values as JSON", () => {
      const data = {
        agents: {
          hermes: {
            args: ["--flag", "--verbose"],
          },
        },
      };

      const result = formatOutput(data, "text", "config list");
      expect(result).toContain('["--flag","--verbose"]');
    });

    test("does not throw on empty config", () => {
      const result = formatOutput({}, "text", "config list");
      expect(result).toBe("");
    });

    test("does not throw on null/undefined data", () => {
      expect(() => formatOutput(null, "text", "config list")).not.toThrow();
      expect(() => formatOutput(undefined, "text", "config list")).not.toThrow();
    });
  });

  describe("config get", () => {
    test("renders scalar value as bare string", () => {
      const data = { value: "claude-code" };
      const result = formatOutput(data, "text", "config get");
      expect(result).toBe("claude-code");
    });

    test("renders number value as string", () => {
      const data = { value: 4 };
      const result = formatOutput(data, "text", "config get");
      expect(result).toBe("4");
    });

    test("renders object value as flattened key-value pairs", () => {
      const data = {
        value: {
          command: "uwf-hermes",
          args: [],
        },
      };
      const result = formatOutput(data, "text", "config get");
      expect(result).toContain("command");
      expect(result).toContain("uwf-hermes");
      expect(result).toContain("args");
      expect(result).toContain("[]");
    });

    test("does not throw on null value", () => {
      expect(() => formatOutput({ value: null }, "text", "config get")).not.toThrow();
    });

    test("does not throw on missing value field", () => {
      expect(() => formatOutput({}, "text", "config get")).not.toThrow();
    });
  });

  describe("config set", () => {
    test("renders key = value confirmation for scalar", () => {
      const data = { key: "defaultAgent", value: "hermes" };
      const result = formatOutput(data, "text", "config set");
      expect(result).toBe("defaultAgent = hermes");
    });

    test("renders key = value for array values as JSON", () => {
      const data = { key: "agents.hermes.args", value: ["--verbose"] };
      const result = formatOutput(data, "text", "config set");
      expect(result).toBe('agents.hermes.args = ["--verbose"]');
    });

    test("does not throw on missing key/value", () => {
      expect(() => formatOutput({}, "text", "config set")).not.toThrow();
      expect(() => formatOutput(null, "text", "config set")).not.toThrow();
    });
  });

  describe("text format fallback", () => {
    test("falls back to JSON pretty-print when no renderer registered", () => {
      const data = { hello: "world" };
      const result = formatOutput(data, "text", "unknown command");
      expect(result).toBe(JSON.stringify(data, null, 2));
    });

    test("falls back to JSON pretty-print when commandPath is null", () => {
      const data = { hello: "world" };
      const result = formatOutput(data, "text", undefined);
      expect(result).toBe(JSON.stringify(data, null, 2));
    });
  });

  describe("json and yaml formats unaffected", () => {
    test("json format still works with commandPath", () => {
      const data = { key: "value" };
      const result = formatOutput(data, "json", "config list");
      expect(result).toBe(JSON.stringify(data));
    });

    test("yaml format still works with commandPath", () => {
      const data = { key: "value" };
      const result = formatOutput(data, "yaml", "config list");
      expect(result).toContain("key: value");
    });
  });
});
