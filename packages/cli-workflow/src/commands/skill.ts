export {
  generateActorReference as cmdSkillActor,
  generateArchitectureReference as cmdSkillArchitecture,
  generateCliReference as cmdSkillCli,
  generateModeratorReference as cmdSkillModerator,
  generateUserReference as cmdSkillUser,
  generateYamlReference as cmdSkillYaml,
} from "@uncaged/workflow-util";

const SKILL_NAMES = ["cli", "architecture", "yaml", "moderator", "actor", "user"] as const;

export function cmdSkillList(): ReadonlyArray<string> {
  return [...SKILL_NAMES];
}
