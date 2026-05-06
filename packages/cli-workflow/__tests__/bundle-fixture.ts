import type { ParsedAddArgv } from "../src/add-argv.js";

export const MINIMAL_DESCRIPTOR_YAML = `description: "fixture"
roles: {}
`;

export function addCliArgs(name: string, filePath: string): ParsedAddArgv {
  return { name, filePath, descriptorPath: null, typesPath: null };
}
