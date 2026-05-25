export { generateCliReference as cmdSkillCli } from "@uncaged/workflow-util";
export { generateArchitectureReference as cmdSkillArchitecture } from "@uncaged/workflow-util";
export { generateYamlReference as cmdSkillYaml } from "@uncaged/workflow-util";
export { generateModeratorReference as cmdSkillModerator } from "@uncaged/workflow-util";

const SKILL_NAMES = ["cli", "architecture", "yaml", "moderator"] as const;

export function cmdSkillList(): ReadonlyArray<string> {
  return [...SKILL_NAMES];
}
