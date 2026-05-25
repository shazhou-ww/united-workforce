export {
  generateArchitectureReference as cmdSkillArchitecture,
  generateCliReference as cmdSkillCli,
  generateModeratorReference as cmdSkillModerator,
  generateYamlReference as cmdSkillYaml,
} from "@uncaged/workflow-util";

const SKILL_NAMES = ["cli", "architecture", "yaml", "moderator"] as const;

export function cmdSkillList(): ReadonlyArray<string> {
  return [...SKILL_NAMES];
}
