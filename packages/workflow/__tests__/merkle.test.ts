import { describe, expect, test } from "bun:test";

import { createContentMerkleNode, parseMerkleNode, serializeMerkleNode } from "../src/merkle.js";

describe("merkle", () => {
  test("content node roundtrips through YAML", () => {
    const node = createContentMerkleNode("hello\nworld");
    const yaml = serializeMerkleNode(node);
    const back = parseMerkleNode(yaml);
    expect(back).toEqual(node);
  });

  test("step node with object payload roundtrips", () => {
    const node = {
      type: "step" as const,
      payload: { role: "planner", foo: 1 },
      children: ["ABC123", "DEF456"],
    };
    const yaml = serializeMerkleNode(node);
    const back = parseMerkleNode(yaml);
    expect(back.type).toBe("step");
    expect(back.payload).toEqual({ role: "planner", foo: 1 });
    expect(back.children).toEqual(["ABC123", "DEF456"]);
  });

  test("parse rejects invalid YAML root", () => {
    expect(() => parseMerkleNode("[]")).toThrow();
  });
});
